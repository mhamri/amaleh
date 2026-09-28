import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { family } from '../../../amaleh/scripts/family.ts';
import { MODELS } from '../../src/lib/models.ts';
import { topologyPoolBox } from '../../src/lib/topology-layout.ts';

const here = fileURLToPath(new URL('../../../', import.meta.url));
const routes = ['', 'docs'];
const INSET = 4;
const NAME_FONT_SIZE_FLOOR = 10;
const MONO_ADVANCE = 0.6;
const SANS_ADVANCE = 0.62;
const MAX_POOL = 6;
const LONGEST_NAME = 10;

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

function segments(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'g'))].map((m) => m[0]);
}

function svgTexts(svg) {
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) => decode(m[1].replace(/<[^>]+>/g, '')).trim());
}

function ariaLabel(svg) {
  return decode(/aria-label="([^"]*)"/.exec(svg)?.[1] ?? '');
}

function wordPattern(name) {
  return new RegExp(`(^|[^A-Za-z])${name.replace(/ /g, '\\s+')}([^A-Za-z]|$)`);
}

function textBox(text) {
  const width = [...text.text].length * text.fontSize * (text.mono ? MONO_ADVANCE : SANS_ADVANCE);
  const x0 = text.anchor === 'middle' ? text.x - width / 2 : text.anchor === 'end' ? text.x - width : text.x;
  return { x0, x1: x0 + width, y0: text.y - text.fontSize * 0.8, y1: text.y + text.fontSize * 0.25 };
}

function touches(a, b) {
  return a.x0 < b.x1 + 0.5 && b.x0 < a.x1 + 0.5 && a.y0 < b.y1 + 0.5 && b.y0 < a.y1 + 0.5;
}

async function expectedPool(failures) {
  const models = JSON.parse(await readFile(join(here, 'amaleh/models.json'), 'utf8'));
  const known = (id) => {
    const key = family(id);
    if (!MODELS[key]) {
      failures.push(`amaleh/models.json routes ${id} to the family '${key}', which website/src/lib/models.ts has no identity for`);
      return null;
    }
    return key;
  };
  const flash = [];
  for (const id of models.flash ?? []) {
    const key = known(id);
    if (key && !flash.includes(key)) flash.push(key);
  }
  const routed = new Set(flash);
  for (const id of [models.jev, ...(models.deep ?? [])]) {
    const key = known(id);
    if (key) routed.add(key);
  }
  return { workers: flash.map((key) => MODELS[key].name), routed };
}

function syntheticPools() {
  const pools = [];
  for (let size = 2; size <= MAX_POOL; size += 1) {
    pools.push({ label: `${size} names of ${LONGEST_NAME} characters`, names: Array.from({ length: size }, (_, i) => `Worker0-${`${i}`.padStart(2, '0')}`) });
    pools.push({ label: `${size} mixed names`, names: Array.from({ length: size }, (_, i) => ['Worker0-' + `${i}`.padStart(2, '0'), 'A', 'Model name', 'Zz', 'Qwen Coder'][i % 5]) });
  }
  return pools;
}

function checkLayout(failures) {
  const variants = ['narrow', 'wide'];
  const kinds = ['title', 'name', 'note'];
  for (const variant of variants) {
    let reference;
    for (const pool of syntheticPools()) {
      const at = `the ${variant} Flash pool box with ${pool.label}`;
      let layout;
      try {
        layout = topologyPoolBox(pool.names, variant);
      } catch (error) {
        failures.push(`${at}: topologyPoolBox threw ${error.message}`);
        continue;
      }
      const { box, texts } = layout;
      reference ??= box;
      for (const text of texts) {
        if (!kinds.includes(text.kind)) failures.push(`${at}: "${text.text}" carries kind ${text.kind}, expected title, name or note`);
      }
      if (texts.filter((text) => text.kind === 'title').length !== 1) {
        failures.push(`${at}: the box carries ${texts.filter((text) => text.kind === 'title').length} texts of kind title, expected exactly one`);
      }
      const named = texts.filter((text) => text.kind === 'name').map((text) => text.text);
      if (named.join('|') !== pool.names.join('|')) {
        failures.push(`${at}: the texts of kind name are [${named.join(', ')}], expected the pool names in order, so a caller can style them by kind`);
      }
      for (const key of ['x', 'y', 'width', 'height']) {
        if (box[key] !== reference[key]) {
          failures.push(`${at}: the box ${key} is ${box[key]}, but it is ${reference[key]} for every pool size, so the box must keep one size per variant`);
        }
      }
      for (const name of pool.names) {
        const drawn = texts.filter((text) => text.text === name);
        if (drawn.length !== 1) failures.push(`${at}: ${name} is drawn ${drawn.length} times`);
        else if (drawn[0].fontSize < NAME_FONT_SIZE_FLOOR) {
          failures.push(`${at}: ${name} is drawn at ${drawn[0].fontSize}, below the ${NAME_FONT_SIZE_FLOOR} unit floor`);
        }
      }
      const boxes = texts.map((text) => ({ text, box: textBox(text) }));
      for (const { text, box: drawn } of boxes) {
        if (drawn.x0 < box.x + INSET || drawn.x1 > box.x + box.width - INSET || drawn.y0 < box.y + INSET || drawn.y1 > box.y + box.height - INSET) {
          failures.push(`${at}: "${text.text}" leaves the box`);
        }
      }
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          if (touches(boxes[i].box, boxes[j].box)) {
            failures.push(`${at}: "${boxes[i].text.text}" touches "${boxes[j].text.text}"`);
          }
        }
      }
    }
  }
}

async function checkBuiltPages(failures, publicDir) {
  const pool = await expectedPool(failures);
  const workers = pool.workers;
  const expected = [...workers].sort();
  const scan = (text) => text.replace(/Claude Code/g, ' ');
  const named = (text) => workers.filter((name) => wordPattern(name).test(scan(text)));
  const foreign = (text) =>
    Object.keys(MODELS)
      .filter(
        (key) =>
          !pool.routed.has(key) &&
          MODELS[key].name.length > 2 &&
          wordPattern(MODELS[key].name).test(scan(text)),
      )
      .map((key) => MODELS[key].name);
  const same = (found, wanted) => found.length === wanted.length && found.every((name, i) => name === wanted[i]);
  if (workers.length === 0) {
    failures.push('amaleh/models.json routes no flash model the topology diagram can name');
    return;
  }
  for (const route of routes) {
    const file = resolve(publicDir, route, 'index.html');
    let html;
    try {
      html = await readFile(file, 'utf8');
    } catch {
      failures.push(`no built page ${relative(here, file)}; run node website/scripts/build.mjs first`);
      continue;
    }
    const figures = segments(html, 'figure').filter((figure) => /data-topo-svg/.test(figure));
    if (figures.length !== 1) {
      failures.push(`/${route}/ carries ${figures.length} topology figures, expected exactly one`);
      continue;
    }
    const svgs = segments(figures[0], 'svg').filter((svg) => /data-topo-svg/.test(svg));
    if (svgs.length !== 2) {
      failures.push(`/${route}/ topology carries ${svgs.length} SVG variants, expected two`);
    }
    for (const [index, svg] of svgs.entries()) {
      const where = `/${route}/ topology variant ${index + 1}`;
      const labels = svgTexts(svg);
      for (const worker of workers) {
        if (labels.filter((label) => label === worker).length !== 1) {
          failures.push(`${where} draws ${worker} ${labels.filter((label) => label === worker).length} times, once as a label in the Flash pool box`);
        }
      }
      for (const [what, text] of [['labels', labels.join(' | ')], ['aria-label', ariaLabel(svg)]]) {
        for (const stale of foreign(text)) {
          failures.push(`${where} ${what} name ${stale}, a model amaleh/models.json no longer routes`);
        }
        const found = named(text).sort();
        if (!same(found, expected)) {
          failures.push(`${where} ${what} name workers [${found.join(', ')}], expected exactly [${expected.join(', ')}] from amaleh/models.json`);
        }
      }
    }
    const caption = visibleText(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/.exec(figures[0])?.[1] ?? '');
    for (const stale of foreign(caption)) {
      failures.push(`/${route}/ topology caption names ${stale}, a model amaleh/models.json no longer routes`);
    }
    const found = named(caption).sort();
    if (!same(found, expected)) {
      failures.push(`/${route}/ topology caption names workers [${found.join(', ')}], expected exactly [${expected.join(', ')}] from amaleh/models.json`);
    }
  }
}

export default async function topology({ publicDir }) {
  const failures = [];
  checkLayout(failures);
  await checkBuiltPages(failures, publicDir);
  return failures;
}
