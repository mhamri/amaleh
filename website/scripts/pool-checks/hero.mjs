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
const MIN_LENGTH = 0.8;
const CLEARANCE = 0.3;
const OWN_LABEL_CLEARANCE = 0.1;
const PARALLEL_DISTANCE = 0.12;
const PARALLEL_ALLOWANCE = 0.3;
const SHARED_NODE_ZONE = 0.6;
const STEP = 0.005;
const MARGIN = 0.15;
const DESIGN_WIDTH = 16;
const DESIGN_HEIGHT = 9;
const PORT_EPS = 1e-6;
const DIAGONAL_BAND = 1.1;
const LABEL_BOTTOM = TILE.half + LABEL.gap + LABEL.size * 0.22;

const tileBox = (node) => ({ x0: node.x - TILE.half, y0: node.y - TILE.half, x1: node.x + TILE.half, y1: node.y + TILE.half });

function labelBox(node) {
  const width = [...node.label].length * LABEL.size * 0.62;
  const baseline = node.y + TILE.half + LABEL.gap;
  return { x0: node.x - width / 2, y0: baseline - LABEL.size * 0.78, x1: node.x + width / 2, y1: baseline + LABEL.size * 0.22 };
}

const overlap = (a, b, margin = 0) => a.x0 < b.x1 + margin && b.x0 < a.x1 + margin && a.y0 < b.y1 + margin && b.y0 < a.y1 + margin;

function pointToSegment(px, py, s) {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / lengthSquared));
  return Math.hypot(px - (s.x1 + dx * t), py - (s.y1 + dy * t));
}

function pointToBox(px, py, b) {
  const dx = Math.max(b.x0 - px, 0, px - b.x1);
  const dy = Math.max(b.y0 - py, 0, py - b.y1);
  return Math.hypot(dx, dy);
}

function segmentHitsBox(s, b) {
  let t0 = 0;
  let t1 = 1;
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  for (const [p, q] of [[-dx, s.x1 - b.x0], [dx, b.x1 - s.x1], [-dy, s.y1 - b.y0], [dy, b.y1 - s.y1]]) {
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

function segmentToBox(s, b) {
  if (segmentHitsBox(s, b)) return 0;
  const corners = [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]];
  return Math.min(pointToBox(s.x1, s.y1, b), pointToBox(s.x2, s.y2, b), ...corners.map(([x, y]) => pointToSegment(x, y, s)));
}

function distanceToNodeShape(px, py, node) {
  if (node.family) return pointToBox(px, py, tileBox(node));
  return Math.max(0, Math.hypot(px - node.x, py - node.y) - node.r);
}

function parallelRun(a, b, nodes) {
  const shared = [a.from, a.to].filter((index) => index === b.from || index === b.to).map((index) => nodes[index]);
  const length = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
  const steps = Math.max(1, Math.ceil(length / STEP));
  let run = 0;
  for (let i = 0; i < steps; i += 1) {
    const t = (i + 0.5) / steps;
    const px = a.x1 + (a.x2 - a.x1) * t;
    const py = a.y1 + (a.y2 - a.y1) * t;
    if (shared.some((node) => distanceToNodeShape(px, py, node) < SHARED_NODE_ZONE)) continue;
    if (pointToSegment(px, py, b) < PARALLEL_DISTANCE) run += length / steps;
  }
  return run;
}

const linked = (links, nodes, a, b) =>
  links.some((link) => (nodes[link.from] === a && nodes[link.to] === b) || (nodes[link.from] === b && nodes[link.to] === a));

const reach = (node) => (node.family ? TILE.half : node.r);

function sideOf(node, px, py) {
  const dx = px - node.x;
  const dy = py - node.y;
  const h = reach(node);
  if (Math.abs(dy) < PORT_EPS && Math.abs(dx - h) < PORT_EPS) return 'right';
  if (Math.abs(dy) < PORT_EPS && Math.abs(dx + h) < PORT_EPS) return 'left';
  if (Math.abs(dx) < PORT_EPS && Math.abs(dy + h) < PORT_EPS) return 'top';
  if (Math.abs(dx) < PORT_EPS && dy > 0) return 'bottom';
  return undefined;
}

function runsAway(side, px, py, ox, oy) {
  if (side === 'right') return ox > px + PORT_EPS;
  if (side === 'left') return ox < px - PORT_EPS;
  if (side === 'top') return oy < py - PORT_EPS;
  return oy > py + PORT_EPS;
}

function arrivalSides(node, ox, oy) {
  const dx = ox - node.x;
  const dy = oy - node.y;
  const across = dx >= 0 ? 'right' : 'left';
  const upDown = dy >= 0 ? 'bottom' : 'top';
  if (Math.abs(dx) > DIAGONAL_BAND * Math.abs(dy)) return [across];
  if (Math.abs(dy) > DIAGONAL_BAND * Math.abs(dx)) return [upDown];
  return [across, upDown];
}

function crosses(a, b) {
  const side = (ox, oy, px, py, qx, qy) => {
    const turn = (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
    return Math.abs(turn) < PORT_EPS ? 0 : Math.sign(turn);
  };
  const aEnds = [side(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1), side(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2)];
  const bEnds = [side(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1), side(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2)];
  return aEnds[0] * aEnds[1] === -1 && bEnds[0] * bEnds[1] === -1;
}

function ports(failures, nodes, links, at) {
  const bottomDrops = new Map();
  const name = (link) => `${nodes[link.from]?.label ?? nodes[link.from]?.role} to ${nodes[link.to]?.label ?? nodes[link.to]?.role}`;
  for (const link of links) {
    const ends = [
      { node: nodes[link.from], px: link.x1, py: link.y1, ox: link.x2, oy: link.y2, end: 'start' },
      { node: nodes[link.to], px: link.x2, py: link.y2, ox: link.x1, oy: link.y1, end: 'end' },
    ];
    for (const { node, px, py, ox, oy, end } of ends) {
      if (!node) continue;
      const side = sideOf(node, px, py);
      if (side === undefined) {
        failures.push(`${at}: the ${end} of ${name(link)} sits at (${px.toFixed(2)}, ${py.toFixed(2)}), which is not one of the four ports of ${node.label ?? node.role} at (${node.x.toFixed(2)}, ${node.y.toFixed(2)})`);
        continue;
      }
      if (!runsAway(side, px, py, ox, oy)) {
        failures.push(`${at}: ${name(link)} meets the ${side} port of ${node.label ?? node.role} but runs back across it instead of away from that side`);
      }
      const arrival = arrivalSides(node, ox, oy);
      if (!arrival.includes(side)) {
        failures.push(`${at}: ${name(link)} arrives at ${node.label ?? node.role} from the ${arrival.join(' or ')} but meets its ${side} port`);
      }
      if (side !== 'bottom') continue;
      const drop = py - node.y;
      const known = bottomDrops.get(node);
      if (known !== undefined && Math.abs(known - drop) > PORT_EPS) {
        failures.push(`${at}: ${node.label ?? node.role} has two bottom ports, ${known.toFixed(3)} and ${drop.toFixed(3)} design units below its centre`);
      }
      bottomDrops.set(node, drop);
      if (node.family && drop < LABEL_BOTTOM + 0.05) {
        failures.push(`${at}: the bottom port of ${node.label} is ${drop.toFixed(3)} design units below its centre, inside or touching its label, which ends at ${LABEL_BOTTOM.toFixed(3)}`);
      }
      if (node.family) {
        const shared = [...bottomDrops].find(([other]) => other !== node && other.family);
        if (shared && Math.abs(shared[1] - drop) > PORT_EPS) {
          failures.push(`${at}: the bottom port of ${node.label} is ${drop.toFixed(3)} design units below its centre, while ${shared[0].label} uses ${shared[1].toFixed(3)}`);
        }
      }
      if (!node.family && Math.abs(drop - node.r) > PORT_EPS) {
        failures.push(`${at}: the bottom port of the ${node.role} circle is ${drop.toFixed(3)} below its centre, not on its edge at ${node.r}`);
      }
    }
  }
  for (let i = 0; i < links.length; i += 1) {
    for (let j = i + 1; j < links.length; j += 1) {
      const shared = [links[i].from, links[i].to].filter((index) => index === links[j].from || index === links[j].to);
      if (shared.length === 0 || !crosses(links[i], links[j])) continue;
      const node = nodes[shared[0]];
      failures.push(`${at}: ${name(links[i])} and ${name(links[j])} both meet ${node.label ?? node.role} and cross each other`);
    }
  }
}

function classAttribute(source, markers) {
  const wanted = [].concat(markers);
  for (const match of source.matchAll(/class="([^"]*)"/g)) {
    if (wanted.every((marker) => match[1].includes(marker))) return match[1];
  }
  return null;
}

function utilities(classes, pattern) {
  const found = new Map();
  for (const match of classes.matchAll(pattern)) found.set(match[1] ?? '', match.slice(2).join('/'));
  return found;
}

function forVariant(utilitiesByVariant, variant) {
  return utilitiesByVariant.get(variant) ?? utilitiesByVariant.get('') ?? null;
}

const ASPECT = /(?:^|\s)((?:[a-z]+:)?)aspect-\[(\d+)\/(\d+)\]/g;
const WIDTH = /(?:^|\s)((?:[a-z]+:)?)w-\[(\d+)%\]/g;
const OFFSET = /(?:^|\s)((?:[a-z]+:)?)\[transform:translate\(([^,]+),(.+?)\)\](?=\s|$)/g;

function offsetsOf(classes) {
  const found = new Map();
  for (const match of classes.matchAll(OFFSET)) found.set(match[1] ?? '', `${match[2]},${match[3]}`);
  return found;
}

function percent(term, focus) {
  if (term.includes('var(--hero-focus-x)')) return focus / DESIGN_WIDTH;
  if (term.includes('var(--hero-focus-y)')) return focus / DESIGN_HEIGHT;
  return -Number(/^(-?[\d.]+)%$/.exec(term)?.[1]) / 100;
}

function bands(failures) {
  const file = join(here, 'website/src/components/landing/Problem.tsx');
  const source = readFileSync(file, 'utf8');
  const bandClasses = classAttribute(source, ['overflow-hidden', 'aspect-[']);
  const canvasClasses = classAttribute(source, ['--hero-focus-x', 'w-[']);
  if (!bandClasses || !canvasClasses) {
    failures.push('website/src/components/landing/Problem.tsx no longer states the hero band aspect ratio of every breakpoint and the canvas box it crops with');
    return [];
  }
  const bandAspects = utilities(bandClasses, ASPECT);
  const canvasAspects = utilities(canvasClasses, ASPECT);
  const canvasWidths = utilities(canvasClasses, WIDTH);
  const offsets = offsetsOf(canvasClasses);
  if (!bandAspects.size || !canvasAspects.size || !canvasWidths.size || !offsets.size) {
    failures.push('website/src/components/landing/Problem.tsx no longer states the hero band aspect ratio of every breakpoint and the canvas box it crops with');
    return [];
  }
  for (const variant of ['', 'sm:']) {
    if (!bandAspects.has(variant)) {
      failures.push(`the hero band below lg states no ${variant ? `sm: ` : ''}aspect ratio, so the phone and tablet bands do not each crop the scene with their own aspect ratio`);
    }
  }
  return [...bandAspects].map(([variant, bandAspect]) => {
    const canvasAspect = forVariant(canvasAspects, variant);
    const canvasWidth = forVariant(canvasWidths, variant);
    const offset = forVariant(offsets, variant);
    if (!canvasAspect || !canvasWidth || !offset) {
      failures.push(`${variant ? `the ${variant}` : 'the base'} band states an aspect ratio, but its canvas box states no ${variant ? `${variant} ` : ''}width, aspect ratio or offset to crop it with`);
      return null;
    }
    const [bandWidth, bandHeight] = bandAspect.split('/').map(Number);
    const aspect = bandHeight / bandWidth;
    const width = Number(canvasWidth) / 100;
    const height = (width * Number(canvasAspect.split('/')[1])) / Number(canvasAspect.split('/')[0]);
    const scale = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
    const insetX = (width - DESIGN_WIDTH * scale) / 2;
    const insetY = (height - DESIGN_HEIGHT * scale) / 2;
    const [offsetX, offsetY] = offset.split(',');
    const shiftX = percent(offsetX, HERO_FOCUS.x);
    const shiftY = percent(offsetY, HERO_FOCUS.y);
    const crop = {
      at: variant ? `the ${variant} band` : 'the base band',
      aspect,
      scale,
      window: {
        x0: HERO_FOCUS.x - 0.5 / scale,
        x1: HERO_FOCUS.x + 0.5 / scale,
        y0: HERO_FOCUS.y - 0.5 * aspect / scale,
        y1: HERO_FOCUS.y + 0.5 * aspect / scale,
      },
      cover: {
        x0: 0.5 - shiftX * width,
        x1: 0.5 - shiftX * width + width,
        y0: 0.5 * aspect - shiftY * height,
        y1: 0.5 * aspect - shiftY * height + height,
      },
    };
    const expectedX = (insetX + HERO_FOCUS.x * scale) / width;
    const expectedY = (insetY + HERO_FOCUS.y * scale) / height;
    const numbers = [bandWidth, bandHeight, ...canvasAspect.split('/').map(Number), width, height, scale, insetX, insetY, expectedX, expectedY, percent(offsetX, HERO_FOCUS.x), percent(offsetY, HERO_FOCUS.y)];
    if (!numbers.every((value) => Number.isFinite(value)) || [bandWidth, bandHeight, width, height, scale].some((value) => value <= 0)) {
      failures.push(`${crop.at} states a band aspect ratio, canvas width, canvas aspect ratio or offset this check cannot read: ${bandAspect}, ${canvasAspect}, ${canvasWidth}, ${offset}`);
      return null;
    }
    if (Math.abs(shiftX - expectedX) > 0.0001 || Math.abs(shiftY - expectedY) > 0.0001) {
      failures.push(`${crop.at} offsets its canvas box to ${offsetX}, ${offsetY}, which does not land HERO_FOCUS at the centre of the band; that offset is ${(expectedX * 100).toFixed(4)}%, ${(expectedY * 100).toFixed(4)}%`);
    }
    return crop;
  }).filter(Boolean);
}

function geometry(failures) {
  const crops = bands(failures);
  if (!crops.length) return;
  for (const { at: where, aspect, window, cover } of crops) {
    if (window.y0 < -EPS || window.y1 > DESIGN_HEIGHT + EPS) {
      failures.push(`${where} crops y ${window.y0.toFixed(2)} to ${window.y1.toFixed(2)}, outside the ${DESIGN_HEIGHT} unit design box, so the canvas cannot cover it`);
    }
    if (cover.x0 > EPS || cover.x1 < 1 - EPS || cover.y0 > EPS || cover.y1 < aspect - EPS) {
      failures.push(`${where} is ${(1 / aspect).toFixed(2)} and the canvas box covers x ${cover.x0.toFixed(2)} to ${cover.x1.toFixed(2)} and y ${cover.y0.toFixed(2)} to ${cover.y1.toFixed(2)} of it, so part of the band shows no canvas`);
    }
  }
  for (let n = 2; n <= 6; n += 1) {
    const workers = names.slice(0, n).map((name, index) => ({ family: `w${index}`, name }));
    const deep = [{ family: 'kimi', name: 'Kimi' }];
    const decision = { family: 'jev', name: 'Jev' };
    const at = `n=${n}`;
    let scene;
    try {
      scene = heroScene({ workers, deep, decision });
    } catch (error) {
      failures.push(`${at}: heroScene threw ${error.message}`);
      continue;
    }
    const { nodes, links } = scene;
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
    const hub = nodes.find((node) => node.role === 'coordinator' && !node.family);
    if (!hub) {
      failures.push(`${at}: no coordinator hub`);
      continue;
    }
    if (failures.length) continue;

    const jev = decisions[0];
    const top = workerNodes.slice(0, Math.min(n, 3));
    const bottom = workerNodes.slice(3);
    const rowY = (row) => row.every((worker) => Math.abs(worker.y - row[0].y) < EPS);
    const centred = (row) => Math.abs(row.reduce((sum, worker) => sum + worker.x, 0) / row.length - jev.x) < 0.05;
    if (!rowY(top) || !centred(top) || !(top[0].y < jev.y)) failures.push(`${at}: the first ${top.length} workers must share one row above Jev, centred on Jev's column`);
    if (bottom.length && (!rowY(bottom) || !centred(bottom) || !(bottom[0].y > jev.y))) failures.push(`${at}: workers 4 to ${n} must share one row below Jev, centred on Jev's column`);
    if (!(Math.abs(deeps[0].y - jev.y) < EPS && deeps[0].x > jev.x)) failures.push(`${at}: Kimi must sit to Jev's right in Jev's row`);
    if (!hosts.every((host) => host.y < top[0].y)) failures.push(`${at}: Claude Code and Codex must sit above the top worker row`);
    for (const row of [top, bottom]) {
      for (let i = 1; i < row.length; i += 1) {
        if (!(row[i].x > row[i - 1].x)) failures.push(`${at}: workers in a row must run left to right in pool order`);
      }
    }

    const boxes = [];
    for (const node of nodes.filter((candidate) => candidate.family)) {
      boxes.push({ kind: 'tile', node, box: tileBox(node) });
      if (node.label) boxes.push({ kind: 'label', node, box: labelBox(node) });
    }
    for (const { kind, node, box } of boxes) {
      for (const crop of crops) {
        const window = crop.window;
        if (box.x0 < MARGIN + window.x0 - EPS || box.x1 > window.x1 - MARGIN + EPS || box.y0 < MARGIN + window.y0 - EPS || box.y1 > window.y1 - MARGIN + EPS) {
          failures.push(`${at}: the ${kind} of ${node.label ?? node.family} leaves the ${crop.at} crop by less than ${MARGIN} design units`);
        }
      }
      if (box.x0 < 10.5 - EPS || box.x1 > DESIGN_WIDTH + EPS || box.y0 < -EPS || box.y1 > DESIGN_HEIGHT + EPS) {
        failures.push(`${at}: the ${kind} of ${node.label ?? node.family} leaves x 10.5 to ${DESIGN_WIDTH}, y 0 to ${DESIGN_HEIGHT}`);
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

    ports(failures, nodes, links, at);

    const name = (link) => `${nodes[link.from]?.label ?? nodes[link.from]?.role} to ${nodes[link.to]?.label ?? nodes[link.to]?.role}`;
    links.forEach((link) => {
      const from = nodes[link.from];
      const to = nodes[link.to];
      if (!from || !to) {
        failures.push(`${at}: a link names a missing node`);
        return;
      }
      if (Math.hypot(link.x1 - from.x, link.y1 - from.y) > 1.0 || Math.hypot(link.x2 - to.x, link.y2 - to.y) > 1.0) {
        failures.push(`${at}: link ${name(link)} does not start and end at its nodes`);
      }
      const length = Math.hypot(link.x2 - link.x1, link.y2 - link.y1);
      if (length < MIN_LENGTH) failures.push(`${at}: link ${name(link)} is ${length.toFixed(2)} design units long, below ${MIN_LENGTH}`);
      for (const { kind, node, box } of boxes) {
        const own = node === from || node === to;
        if (own && kind === 'tile') continue;
        const distance = segmentToBox(link, box);
        const wanted = own ? OWN_LABEL_CLEARANCE : CLEARANCE;
        if (distance < wanted) failures.push(`${at}: link ${name(link)} passes ${distance.toFixed(2)} design units from the ${kind} of ${node.label ?? node.family}, below ${wanted}`);
      }
    });
    for (let i = 0; i < links.length; i += 1) {
      for (let j = i + 1; j < links.length; j += 1) {
        const a = links[i];
        const b = links[j];
        const sameEnds = (a.from === b.from && a.to === b.to) || (a.from === b.to && a.to === b.from);
        if (sameEnds) continue;
        const run = Math.max(parallelRun(a, b, nodes), parallelRun(b, a, nodes));
        if (run > PARALLEL_ALLOWANCE) {
          failures.push(`${at}: links ${name(a)} and ${name(b)} run within ${PARALLEL_DISTANCE} design units of each other for ${run.toFixed(2)} design units, above ${PARALLEL_ALLOWANCE}`);
        }
      }
    }
    for (const worker of workerNodes) {
      if (!linked(links, nodes, worker, jev)) failures.push(`${at}: ${worker.label} has no link to Jev`);
      if (!workerNodes.some((other) => other !== worker && linked(links, nodes, worker, other))) {
        failures.push(`${at}: ${worker.label} has no review link to another worker`);
      }
    }
    if (!workerNodes.some((worker) => linked(links, nodes, worker, deeps[0]))) failures.push(`${at}: no worker escalates to Kimi`);
    for (const host of hosts) if (!linked(links, nodes, host, hub)) failures.push(`${at}: ${host.label} has no link to the coordinator hub`);
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
