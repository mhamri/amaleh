
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const websiteDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const publicDir = join(websiteDir, '.output/public');

export const trackingHosts = [
  'googletagmanager.com',
  'google-analytics.com',
  'googleadservices.com',
  'doubleclick.net',
  'ads-twitter.com',
  'analytics.twitter.com',
  't.co',
  'connect.facebook.net',
  'facebook.com',
];

export function isTracking(url) {
  const host = new URL(url).hostname;
  return trackingHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

export const failures = [];
export const fail = (message) => failures.push(message);

export function finish(label) {
  if (failures.length) {
    console.error(`${label} failed with ${failures.length} problem(s):`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  console.log(`${label} passed.`);
}

async function loadPuppeteer() {
  const require = createRequire(join(websiteDir, 'package.json'));
  const candidates = [
    'puppeteer',
    'puppeteer-core',
    `${process.env.USERPROFILE ?? process.env.HOME ?? ''}/.bun/install/global/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js`,
  ];
  for (const candidate of candidates) {
    try {
      const specifier = candidate.includes('/')
        ? pathToFileURL(candidate).href
        : pathToFileURL(require.resolve(candidate)).href;
      const loaded = await import(specifier);
      return loaded.default ?? loaded;
    } catch {}
  }
  return null;
}

const contentTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/plain',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serve(dir) {
  return createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      let file = resolve(dir, path.replace(/^\//, ''));
      if (file !== dir && !file.startsWith(dir + sep)) {
        response.writeHead(404).end();
        return;
      }
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      const type = contentTypes[extname(file)] ?? 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
}

export async function startSite() {
  if (!existsSync(publicDir)) {
    console.error(`No build output at ${publicDir}; run node website/scripts/build.mjs first.`);
    process.exit(1);
  }
  const puppeteer = await loadPuppeteer();
  if (!puppeteer) {
    console.log(
      'Browser checks skipped: no puppeteer installation was found. ' +
        'Install puppeteer to run the rendered sweep and the win probes in a browser.',
    );
    process.exit(0);
  }
  const server = serve(publicDir);
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  browser.on('targetcreated', async (target) => {
    if (target.type() !== 'page') return;
    const opened = await target.page().catch(() => null);
    const url = target.url();
    if (opened && url && !url.startsWith(origin) && url !== 'about:blank') await opened.close().catch(() => {});
  });
  return {
    origin,
    browser,
    async close() {
      await browser.close().catch(() => {});
      server.close();
    },
  };
}


export async function openPage(site, { width = 1440, githubApi = null, clipboard = false } = {}) {
  const context = await site.browser.createBrowserContext();
  if (clipboard) await context.overridePermissions(site.origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  const trackingRequests = [];
  const githubRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith(site.origin) || url.startsWith('data:') || url.startsWith('blob:')) return request.continue();
    if (isTracking(url)) {
      trackingRequests.push(url);
      return request.abort();
    }
    if (new URL(url).hostname === 'api.github.com') {
      githubRequests.push({ url, headers: request.headers() });
      const answer = githubApi ? githubApi(request) : null;
      if (!answer) return request.abort();
      return request.respond({
        status: answer.status ?? 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*', ...(answer.headers ?? {}) },
        body: JSON.stringify(answer.body ?? {}),
      });
    }
    return request.abort();
  });
  await page.setViewport({ width, height: 900 });
  return {
    page,
    errors,
    trackingRequests,
    githubRequests,
    async goto(route) {
      await page.goto(site.origin + route, { waitUntil: 'networkidle0' });
      await new Promise((settled) => setTimeout(settled, 300));
    },
    async wins() {
      return page.evaluate(() =>
        (window.dataLayer ?? [])
          .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.event === 'string' && entry.event.startsWith('amaleh_') && entry.event !== 'amaleh_consent_granted')
          .map((entry) => JSON.parse(JSON.stringify(entry))),
      );
    },
    async close() {
      await context.close().catch(() => {});
    },
  };
}

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export function checkPayload(entry, where) {
  const allowed = new Set(['event', 'win_id', 'win_location']);
  for (const key of Object.keys(entry)) {
    if (!allowed.has(key)) fail(`${where}: ${entry.event} carries key "${key}"; a win may carry only event, win_id and win_location`);
  }
  if (typeof entry.win_id !== 'string' || entry.win_id.length < 16) fail(`${where}: ${entry.event} has no win_id string of at least 16 characters`);
}

export function countOf(wins, event) {
  return wins.filter((entry) => entry.event === event).length;
}