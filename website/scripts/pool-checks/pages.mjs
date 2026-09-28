import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { family } from '../../../amaleh/scripts/family.ts';
import { MODELS } from '../../src/lib/models.ts';

const here = fileURLToPath(new URL('../../../', import.meta.url));
const HOST_FAMILIES = ['claude', 'openai'];
const excluded = ['case-study'];

function wordPattern(name) {
  return new RegExp(`(^|[^A-Za-z])${name.replace(/ /g, '\\s+')}([^A-Za-z]|$)`);
}

async function allowedFamilies(failures) {
  const models = JSON.parse(await readFile(join(here, 'amaleh/models.json'), 'utf8'));
  const allowed = new Set(HOST_FAMILIES);
  const ids = [...(models.flash ?? []), ...(models.deep ?? []), models.jev].filter(
    (id) => typeof id === 'string' && id.length > 0,
  );
  for (const id of ids) {
    const key = family(id);
    if (!MODELS[key]) {
      failures.push(
        `amaleh/models.json routes ${id} to the family '${key}', which website/src/lib/models.ts has no identity for, so no page can be checked against that route`,
      );
      continue;
    }
    allowed.add(key);
  }
  return allowed;
}

async function builtPages(publicDir) {
  const entries = await readdir(publicDir, { withFileTypes: true, recursive: true });
  const pages = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
    const file = resolve(entry.parentPath, entry.name);
    const route = relative(publicDir, file).replaceAll('\\', '/');
    if (excluded.some((dir) => route === dir || route.startsWith(`${dir}/`))) continue;
    pages.push({ file, route });
  }
  return pages.sort((a, b) => a.route.localeCompare(b.route));
}

export default async function pages({ publicDir }) {
  const failures = [];
  const allowed = await allowedFamilies(failures);
  const unrouted = Object.entries(MODELS)
    .filter(([key, identity]) => !allowed.has(key) && identity.name.length > 2)
    .map(([key, identity]) => ({ key, name: identity.name, pattern: wordPattern(identity.name) }));
  let pages;
  try {
    pages = await builtPages(publicDir);
  } catch {
    return [...failures, `no built pages under ${publicDir}; run node website/scripts/build.mjs first`];
  }
  for (const { file, route } of pages) {
    const html = await readFile(file, 'utf8');
    for (const { key, name, pattern } of unrouted) {
      if (pattern.test(html)) {
        failures.push(
          `/${route} names ${name}, the '${key}' identity in website/src/lib/models.ts, which amaleh/models.json does not route as a worker, a repair model, the decision model or a coordinator host`,
        );
      }
    }
  }
  return failures;
}
