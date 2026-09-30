import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { family } from '../../../amaleh/scripts/family.ts';
import { MODELS } from '../../src/lib/models.ts';

const here = fileURLToPath(new URL('../../../', import.meta.url));
const LAYOUTS = ['wide', 'narrow'];

function flashWorkers() {
  const models = JSON.parse(readFileSync(join(here, 'amaleh/models.json'), 'utf8'));
  const expected = [];
  for (const id of models.flash ?? []) {
    const key = family(id);
    if (!expected.some((worker) => worker.family === key)) expected.push({ family: key, name: MODELS[key]?.name ?? null });
  }
  return expected;
}

function built(failures, publicDir) {
  const file = join(publicDir, 'index.html');
  if (!existsSync(file)) {
    failures.push('no built hero at website/.output/public/index.html; run node website/scripts/build.mjs first');
    return;
  }
  const expected = flashWorkers();
  const html = readFileSync(file, 'utf8');
  const heroes = [...html.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map((match) => match[0]).filter((svg) => /data-model="/.test(svg));
  const layouts = heroes
    .map((svg) => /data-hero-layout="([a-z]+)"/.exec(svg)?.[1])
    .filter(Boolean)
    .sort();
  if (layouts.length !== LAYOUTS.length || LAYOUTS.some((layout) => !layouts.includes(layout))) {
    failures.push(`the built hero draws the layouts [${layouts.join(', ')}], expected [${LAYOUTS.join(', ')}]`);
    return;
  }
  for (const layout of LAYOUTS) {
    const hero = heroes.find((svg) => svg.includes(`data-hero-layout="${layout}"`));
    if (!hero) {
      failures.push(`the built hero has no svg[data-hero-layout="${layout}"]`);
      continue;
    }
    const tiles = [...hero.matchAll(/<g\b([^>]*\bdata-model="([^"]+)"[^>]*)>/g)].map((match, index, all) => ({
      attributes: match[1],
      family: match[2],
      body: hero.slice(match.index, all[index + 1]?.index ?? hero.length),
    }));
    const workerTiles = tiles.filter((tile) => /\bdata-role="worker"/.test(tile.attributes));
    const families = workerTiles.map((tile) => tile.family).sort();
    const wanted = expected.map((worker) => worker.family).sort();
    const same = families.length === wanted.length && families.every((value, index) => value === wanted[index]);
    if (!same) failures.push(`the built ${layout} hero worker tiles are [${families.join(', ')}], expected [${wanted.join(', ')}]`);
    const text = (tile) => [...tile.body.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((match) => match[1].replace(/<[^>]+>/g, '').trim());
    for (const worker of expected) {
      const tile = workerTiles.find((candidate) => candidate.family === worker.family);
      if (!tile) continue;
      const labels = text(tile).filter((value) => value.length > 0);
      if (!worker.name || !labels.includes(worker.name)) {
        failures.push(`the built ${layout} hero tile ${worker.family} is labelled [${labels.join(', ')}], expected [${worker.name}]`);
      }
    }
    if (!/data-role="coordinator"/.test(hero)) {
      failures.push(`the built ${layout} hero has no hub with data-role="coordinator"`);
    }
    const patches = [...hero.matchAll(/data-label-patch/g)].length;
    if (patches !== tiles.length) {
      failures.push(`the built ${layout} hero draws ${patches} label patches for ${tiles.length} model tiles`);
    }
  }
}

export default async function hero({ publicDir }) {
  const failures = [];
  built(failures, publicDir);
  return failures;
}
