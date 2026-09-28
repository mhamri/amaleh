import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { family } from '../../../amaleh/scripts/family.ts';
import { MODELS } from '../../src/lib/models.ts';
import { heroScene, TILE, LABEL, HERO_FOCUS } from '../../src/lib/hero-scene.ts';

const here = fileURLToPath(new URL('../../../', import.meta.url));
const names = ['DeepSeek', 'Stealth', 'MiMo', 'GLM', 'Qwen Coder', 'Nemotron'];
const EPS = 0.005;
const GAP = 0.04;
const CLEARANCE = 0.1;

const tileBox = (node) => ({ x0: node.x - TILE.half, y0: node.y - TILE.half, x1: node.x + TILE.half, y1: node.y + TILE.half });

function labelBox(node) {
  const width = [...node.label].length * LABEL.size * 0.62;
  const baseline = node.y + TILE.half + LABEL.gap;
  return { x0: node.x - width / 2, y0: baseline - LABEL.size * 0.78, x1: node.x + width / 2, y1: baseline + LABEL.size * 0.22 };
}

const overlap = (a, b, margin = 0) => a.x0 < b.x1 + margin && b.x0 < a.x1 + margin && a.y0 < b.y1 + margin && b.y0 < a.y1 + margin;
const shrink = (box, edge) => ({ x0: box.x0 + edge, y0: box.y0 + edge, x1: box.x1 - edge, y1: box.y1 - edge });
const grow = (box, edge) => ({ x0: box.x0 - edge, y0: box.y0 - edge, x1: box.x1 + edge, y1: box.y1 + edge });

function segmentHitsBox(segment, box) {
  let t0 = 0;
  let t1 = 1;
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  for (const [p, q] of [[-dx, segment.x1 - box.x0], [dx, box.x1 - segment.x1], [-dy, segment.y1 - box.y0], [dy, box.y1 - segment.y1]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function geometry(failures) {
  for (let n = 2; n <= 6; n += 1) {
    const workers = names.slice(0, n).map((name, index) => ({ family: `w${index}`, name }));
    const deep = [{ family: 'kimi', name: 'Kimi' }];
    const decision = { family: 'jev', name: 'Jev' };
    let scene;
    try {
      scene = heroScene({ workers, deep, decision });
    } catch (error) {
      failures.push(`n=${n}: heroScene threw ${error.message}`);
      continue;
    }
    const { nodes, links } = scene;
    const at = `n=${n}`;
    const workerNodes = nodes.filter((node) => node.role === 'worker');
    const decisions = nodes.filter((node) => node.role === 'decision');
    const deeps = nodes.filter((node) => node.role === 'deep');
    const hosts = nodes.filter((node) => node.role === 'host');
    if (workerNodes.length !== n) failures.push(`${at}: ${workerNodes.length} worker nodes`);
    workerNodes.forEach((node, index) => {
      if (node.label !== workers[index].name || node.family !== workers[index].family) {
        failures.push(`${at}: worker ${index} is ${node.family}/${node.label}, expected ${workers[index].family}/${workers[index].name}`);
      }
    });
    if (decisions.length !== 1 || decisions[0].label !== 'Jev') failures.push(`${at}: expected one decision node labelled Jev`);
    if (deeps.length !== 1 || deeps[0].label !== 'Kimi') failures.push(`${at}: expected one deep node labelled Kimi`);
    if (hosts.length !== 2 || !hosts.some((host) => host.label === 'Claude Code') || !hosts.some((host) => host.label === 'Codex')) {
      failures.push(`${at}: expected host nodes Claude Code and Codex`);
    }
    if (!nodes.some((node) => node.role === 'coordinator' && !node.family)) failures.push(`${at}: no coordinator hub`);
    if (failures.length) continue;

    const jev = decisions[0];
    const top = workerNodes.slice(0, Math.min(n, 3));
    const bottom = workerNodes.slice(3);
    const rowY = (row) => row.every((worker) => Math.abs(worker.y - row[0].y) < EPS);
    const centred = (row) => Math.abs(row.reduce((sum, worker) => sum + worker.x, 0) / row.length - jev.x) < 0.05;
    if (!rowY(top) || !centred(top) || !(top[0].y < jev.y)) failures.push(`${at}: the first ${top.length} workers must share one row above Jev, centred on Jev's column`);
    if (bottom.length && (!rowY(bottom) || !centred(bottom) || !(bottom[0].y > jev.y))) failures.push(`${at}: workers 4 to ${n} must share one row below Jev, centred on Jev's column`);
    if (!(Math.abs(deeps[0].y - jev.y) < EPS && deeps[0].x > jev.x)) failures.push(`${at}: Kimi must sit to Jev's right in Jev's row`);
    for (const row of [top, bottom]) {
      for (let i = 1; i < row.length; i += 1) {
        if (!(row[i].x > row[i - 1].x)) failures.push(`${at}: workers in a row must run left to right in pool order`);
      }
    }

    const window = {
      x0: Math.max(10.5, HERO_FOCUS.x - 3.2),
      x1: Math.min(16, HERO_FOCUS.x + 3.2),
      y0: Math.max(0, HERO_FOCUS.y - 3.33),
      y1: Math.min(9, HERO_FOCUS.y + 3.33),
    };
    const boxes = [];
    for (const node of nodes.filter((candidate) => candidate.family)) {
      boxes.push({ kind: 'tile', node, box: tileBox(node) });
      if (node.label) boxes.push({ kind: 'label', node, box: labelBox(node) });
    }
    for (const { kind, node, box } of boxes) {
      if (box.x0 < window.x0 || box.x1 > window.x1 || box.y0 < window.y0 || box.y1 > window.y1) {
        failures.push(`${at}: ${kind} of ${node.label ?? node.family} leaves the visible window`);
      }
    }
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        if (boxes[i].node === boxes[j].node) continue;
        if (overlap(boxes[i].box, boxes[j].box, GAP)) {
          failures.push(`${at}: ${boxes[i].kind} of ${boxes[i].node.label} touches ${boxes[j].kind} of ${boxes[j].node.label}`);
        }
      }
    }
    links.forEach((link, index) => {
      const from = nodes[link.from];
      const to = nodes[link.to];
      if (!from || !to) {
        failures.push(`${at}: link ${index} names a missing node`);
        return;
      }
      const name = `link ${index} (${from.label ?? from.role} to ${to.label ?? to.role})`;
      if (Math.hypot(link.x1 - from.x, link.y1 - from.y) > 1.0 || Math.hypot(link.x2 - to.x, link.y2 - to.y) > 1.0) {
        failures.push(`${at}: ${name} does not start and end at its nodes`);
      }
      for (const { kind, node, box } of boxes) {
        if (kind === 'tile' && (node === from || node === to)) continue;
        if (segmentHitsBox(link, shrink(box, EPS))) failures.push(`${at}: ${name} crosses the ${kind} of ${node.label ?? node.family}`);
        else if (segmentHitsBox(link, grow(box, CLEARANCE))) failures.push(`${at}: ${name} passes within ${CLEARANCE} design units of the ${kind} of ${node.label ?? node.family}, so its glow reaches it`);
      }
    });
    const linked = (a, b) => links.some((link) => (nodes[link.from] === a && nodes[link.to] === b) || (nodes[link.from] === b && nodes[link.to] === a));
    for (const worker of workerNodes) {
      if (!linked(worker, jev)) failures.push(`${at}: ${worker.label} has no link to Jev`);
      if (!workerNodes.some((other) => other !== worker && linked(worker, other))) failures.push(`${at}: ${worker.label} has no review link to another worker`);
    }
    if (!workerNodes.some((worker) => linked(worker, deeps[0]))) failures.push(`${at}: no worker escalates to Kimi`);
  }
}

function built(failures, publicDir) {
  const file = join(publicDir, 'index.html');
  if (!existsSync(file)) {
    failures.push('no built hero at website/.output/public/index.html; run node website/scripts/build.mjs first');
    return;
  }
  const models = JSON.parse(readFileSync(join(here, 'amaleh/models.json'), 'utf8'));
  const expected = [];
  for (const id of models.flash ?? []) {
    const key = family(id);
    if (!expected.some((worker) => worker.family === key)) expected.push({ family: key, name: MODELS[key]?.name ?? null });
  }
  const html = readFileSync(file, 'utf8');
  const heroes = [...html.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map((match) => match[0]).filter((svg) => /data-model="/.test(svg));
  if (heroes.length !== 1) {
    failures.push(`/ has ${heroes.length} hero SVGs with model tiles, expected exactly one`);
    return;
  }
  const hero = heroes[0];
  const tiles = [...hero.matchAll(/<g\b([^>]*\bdata-model="([^"]+)"[^>]*)>/g)].map((match, index, all) => ({
    attributes: match[1],
    family: match[2],
    body: hero.slice(match.index, all[index + 1]?.index ?? hero.length),
  }));
  const workerTiles = tiles.filter((tile) => /\bdata-role="worker"/.test(tile.attributes));
  const families = workerTiles.map((tile) => tile.family).sort();
  const wanted = expected.map((worker) => worker.family).sort();
  const same = families.length === wanted.length && families.every((value, index) => value === wanted[index]);
  if (!same) failures.push(`the built hero worker tiles are [${families.join(', ')}], expected [${wanted.join(', ')}]`);
  const text = (tile) => [...tile.body.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((match) => match[1].replace(/<[^>]+>/g, '').trim());
  for (const worker of expected) {
    const tile = workerTiles.find((candidate) => candidate.family === worker.family);
    if (!tile) continue;
    const labels = text(tile).filter((value) => value.length > 0);
    if (!worker.name || !labels.includes(worker.name)) {
      failures.push(`the built hero tile ${worker.family} is labelled [${labels.join(', ')}], expected [${worker.name}]`);
    }
  }
}

export default async function hero({ publicDir }) {
  const failures = [];
  geometry(failures);
  built(failures, publicDir);
  return failures;
}
