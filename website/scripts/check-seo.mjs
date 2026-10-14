// See website/SEO.md — verifies the built output carries the metadata, structured data and sitemap the site promises.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHARE_IMAGE } from '../src/lib/brand.ts';
import { SITE_URL } from '../src/lib/links.ts';
import {
  CASE_STUDY_PATH,
  EVIDENCE_PATH,
  HOME_PATH,
  SHARE_IMAGE_URL,
  SITE_NAME,
  TWITTER_HANDLE,
  canonicalUrl,
} from '../src/lib/seo.ts';

const publicDir = fileURLToPath(new URL('../.output/public/', import.meta.url));

if (!existsSync(publicDir)) {
  console.error(`No build output at ${publicDir}; run npm run build first.`);
  process.exit(1);
}

const failures = [];
function fail(message) {
  failures.push(message);
}

function meta(html, attribute, name) {
  const tag = new RegExp(`<meta\\b[^>]*\\b${attribute}="${name}"[^>]*>`, 'i').exec(html)?.[0];
  return tag && /\bcontent="([^"]*)"/i.exec(tag)?.[1];
}

function link(html, rel) {
  const tag = new RegExp(`<link\\b[^>]*\\brel="${rel}"[^>]*>`, 'i').exec(html)?.[0];
  return tag && /\bhref="([^"]*)"/i.exec(tag)?.[1];
}

function jsonLd(html, label) {
  const blocks = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script\b[^>]*>/gi)].map(
    (match) => match[1],
  );
  if (blocks.length === 0) fail(`${label}: no application/ld+json script`);
  const nodes = [];
  for (const block of blocks) {
    if (block.includes('<')) fail(`${label}: JSON-LD contains an unescaped "<"`);
    let data;
    try {
      data = JSON.parse(block);
    } catch (error) {
      fail(`${label}: JSON-LD does not parse: ${error.message}`);
      continue;
    }
    for (const item of Array.isArray(data) ? data : [data]) {
      if (item['@context'] !== 'https://schema.org') fail(`${label}: JSON-LD @context is ${item['@context']}`);
      nodes.push(...(item['@graph'] ?? [item]));
    }
  }
  return nodes;
}

const types = (nodes) => new Set(nodes.flatMap((node) => [node['@type']].flat()));
const nodeOfType = (nodes, type) => nodes.find((node) => [node['@type']].flat().includes(type));
const isNoindex = (html) => /\bnoindex\b/i.test(meta(html, 'name', 'robots') ?? '');

function builtPages() {
  return readdirSync(publicDir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name === 'index.html')
    .map((entry) => {
      const directory = relative(publicDir, entry.parentPath).split(sep).join('/');
      const route = directory ? `${directory}/` : '';
      return { route, label: `/${route}`, html: readFileSync(join(entry.parentPath, entry.name), 'utf8') };
    });
}

const pages = builtPages();
const indexable = pages.filter((page) => !isNoindex(page.html));
const hidden = pages.filter((page) => isNoindex(page.html));
const breadcrumbNames = new Map();

if (!indexable.some((page) => page.route === HOME_PATH)) fail('the home page is missing from the build output or is noindex');

function checkShareTags(html, label, url) {
  if (link(html, 'canonical') !== url) fail(`${label}: canonical is ${link(html, 'canonical')}, expected ${url}`);
  if (meta(html, 'property', 'og:url') !== url) fail(`${label}: og:url is ${meta(html, 'property', 'og:url')}`);
  if (meta(html, 'property', 'og:site_name') !== SITE_NAME) {
    fail(`${label}: og:site_name is ${meta(html, 'property', 'og:site_name')}`);
  }
  if (meta(html, 'property', 'og:image') !== SHARE_IMAGE_URL) {
    fail(`${label}: og:image is ${meta(html, 'property', 'og:image')}`);
  }
  for (const property of ['og:image:width', 'og:image:height']) {
    const value = meta(html, 'property', property);
    if (value !== String(SHARE_IMAGE.size)) fail(`${label}: ${property} is ${value}, expected ${SHARE_IMAGE.size}`);
  }
  if (!meta(html, 'property', 'og:image:alt')) fail(`${label}: og:image:alt missing`);
  if (meta(html, 'name', 'twitter:card') !== 'summary') {
    fail(`${label}: twitter:card is ${meta(html, 'name', 'twitter:card')}`);
  }
  for (const name of ['twitter:site', 'twitter:creator']) {
    if (meta(html, 'name', name) !== TWITTER_HANDLE) fail(`${label}: ${name} is ${meta(html, 'name', name)}`);
  }
}

function checkHomeGraph(nodes, label) {
  const found = types(nodes);
  for (const type of ['WebSite', 'Person']) if (!found.has(type)) fail(`${label}: JSON-LD has no ${type}`);
  if (!found.has('SoftwareApplication') && !found.has('SoftwareSourceCode')) {
    fail(`${label}: JSON-LD has no SoftwareApplication or SoftwareSourceCode`);
  }
}

function checkArticleGraph(nodes, html, label, url) {
  const article = nodeOfType(nodes, 'TechArticle');
  if (!article) {
    fail(`${label}: JSON-LD has no TechArticle`);
  } else {
    const title = /<title[^>]*>([^<]+)<\/title>/.exec(html)?.[1];
    if (article.headline !== title) fail(`${label}: TechArticle headline ${article.headline} is not the page title ${title}`);
    if (article.description !== meta(html, 'name', 'description')) {
      fail(`${label}: TechArticle description is not the page meta description`);
    }
  }
  const breadcrumb = nodeOfType(nodes, 'BreadcrumbList');
  if (!breadcrumb) {
    fail(`${label}: JSON-LD has no BreadcrumbList`);
    return;
  }
  const items = breadcrumb.itemListElement ?? [];
  for (const item of items) {
    const itemUrl = typeof item.item === 'string' ? item.item : item.item?.['@id'];
    if (!breadcrumbNames.has(itemUrl)) breadcrumbNames.set(itemUrl, new Set());
    breadcrumbNames.get(itemUrl).add(item.name);
  }
  const last = items[items.length - 1];
  const lastUrl = typeof last?.item === 'string' ? last.item : last?.item?.['@id'];
  if (items.length === 0 || lastUrl !== url) fail(`${label}: BreadcrumbList does not end at ${url}`);
}

for (const { route, label, html } of indexable) {
  const url = canonicalUrl(route);
  checkShareTags(html, label, url);
  const nodes = jsonLd(html, label);
  if (route === HOME_PATH) checkHomeGraph(nodes, label);
  else checkArticleGraph(nodes, html, label, url);
}

for (const [url, names] of breadcrumbNames) {
  if (names.size > 1) fail(`breadcrumb ${url} is named differently on different pages: ${[...names].join(', ')}`);
}

const indexableUrls = new Set(indexable.map((page) => canonicalUrl(page.route)));
for (const { label, html } of hidden) {
  const canonical = link(html, 'canonical');
  if (!indexableUrls.has(canonical)) fail(`${label}: noindex page's canonical ${canonical} is not an indexable page`);
}

const evidence = pages.find((page) => page.route === EVIDENCE_PATH);
if (!evidence) fail(`/${EVIDENCE_PATH}: redirect page missing from the build output`);
else {
  if (!isNoindex(evidence.html)) fail(`/${EVIDENCE_PATH}: redirect page is not noindex`);
  if (link(evidence.html, 'canonical') !== canonicalUrl(CASE_STUDY_PATH)) {
    fail(`/${EVIDENCE_PATH}: canonical is ${link(evidence.html, 'canonical')}, expected ${canonicalUrl(CASE_STUDY_PATH)}`);
  }
}

const sitemapFile = join(publicDir, 'sitemap.xml');
if (!existsSync(sitemapFile)) {
  fail('sitemap.xml missing from the build output');
} else {
  const locs = new Set([...readFileSync(sitemapFile, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]));
  for (const url of indexableUrls) if (!locs.has(url)) fail(`sitemap.xml misses ${url}`);
  for (const loc of locs) {
    if (!indexableUrls.has(loc)) fail(`sitemap.xml lists ${loc}, which is not an indexable built page`);
    if (!loc.startsWith(SITE_URL)) fail(`sitemap.xml has a loc outside ${SITE_URL}: ${loc}`);
  }
}

const shareFile = join(publicDir, SHARE_IMAGE.publicPath);
if (!existsSync(shareFile)) {
  fail(`${SHARE_IMAGE.publicPath} missing from the build output`);
} else {
  const png = readFileSync(shareFile);
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  if (width !== SHARE_IMAGE.size || height !== SHARE_IMAGE.size) {
    fail(`${SHARE_IMAGE.publicPath} is ${width}x${height}, but src/lib/brand.ts declares ${SHARE_IMAGE.size}x${SHARE_IMAGE.size}`);
  }
}

if (failures.length > 0) {
  console.error(`SEO verification failed with ${failures.length} problem(s):\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}

console.log(
  `SEO verification passed: ${indexable.length} indexable built pages carry canonical, og:url, og:site_name, ` +
    `og:image with width, height and alt, twitter:card summary and ${TWITTER_HANDLE}; the home page carries ` +
    'WebSite, Person and SoftwareSourceCode; every other indexable page carries a TechArticle and a BreadcrumbList ' +
    `ending at its canonical URL, with one name per breadcrumb URL; ${hidden.length} noindex page(s) point their ` +
    `canonical at an indexable page; and sitemap.xml lists exactly the indexable pages at ${SITE_URL}.`,
);
