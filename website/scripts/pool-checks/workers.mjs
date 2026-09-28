import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { family } from '../../../amaleh/scripts/family.ts';
import { MODELS } from '../../src/lib/models.ts';

const here = fileURLToPath(new URL('../../../', import.meta.url));
const routes = ['', 'docs'];

function decode(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function visibleText(html) {
  const withoutCode = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const attributes = [...withoutCode.matchAll(/\s(?:aria-label|title|alt|content)="([^"]*)"/g)].map((m) => m[1]);
  return decode(`${withoutCode.replace(/<[^>]+>/g, ' ')} ${attributes.join(' ')}`).replace(/\s+/g, ' ');
}

function articles(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'g'))].map((m) => m[0]);
}

function wordPattern(name) {
  return new RegExp(`(^|[^A-Za-z])${name.replace(/ /g, '\\s+')}([^A-Za-z]|$)`);
}

async function poolFamilies() {
  const models = JSON.parse(await readFile(join(here, 'amaleh/models.json'), 'utf8'));
  const failures = [];
  const keys = Object.keys(MODELS);
  const known = (id) => {
    const key = family(id);
    if (keys.includes(key)) return key;
    failures.push(`amaleh/models.json routes ${id} to the family '${key}', which website/src/lib/models.ts has no identity for`);
    return null;
  };
  const flash = [];
  for (const id of models.flash) {
    const key = known(id);
    if (key && !flash.includes(key)) flash.push(key);
  }
  const every = new Set(flash.map((key) => key).concat([known(models.jev)]).concat(models.deep.map(known)).filter(Boolean));
  return { flash: flash.sort(), every, failures };
}

export default async function workers({ publicDir }) {
  const pool = await poolFamilies();
  const failures = [...pool.failures];
  const expected = pool.flash.map((key) => MODELS[key].name).sort();
  if (expected.length === 0) return [...failures, 'amaleh/models.json routes no flash model the site can name'];

  for (const route of routes) {
    const file = resolve(publicDir, route, 'index.html');
    let html;
    try {
      html = await readFile(file, 'utf8');
    } catch {
      failures.push(`no built page ${relative(here, file)}; run node website/scripts/build.mjs first`);
      continue;
    }
    const cards = articles(html, 'article').filter((card) => />\s*Workers\s*<\/h3>/.test(card));
    if (cards.length !== 1) {
      failures.push(`/${route}/ carries ${cards.length} Workers cards, expected exactly one`);
      continue;
    }
    const text = visibleText(cards[0]);
    const named = Object.keys(MODELS)
      .filter((key) => MODELS[key].name.length > 2 && wordPattern(MODELS[key].name).test(text));
    for (const key of named) {
      if (!pool.every.has(key)) failures.push(`the Workers card on /${route}/ names ${MODELS[key].name}, a model amaleh/models.json no longer routes`);
    }
    const workers_ = named.filter((key) => pool.flash.includes(key)).map((key) => MODELS[key].name).sort();
    const same = workers_.length === expected.length && workers_.every((name, index) => name === expected[index]);
    if (!same) {
      failures.push(`the Workers card on /${route}/ names [${workers_.join(', ')}], expected exactly [${expected.join(', ')}] from amaleh/models.json`);
    }
  }

  return failures;
}
