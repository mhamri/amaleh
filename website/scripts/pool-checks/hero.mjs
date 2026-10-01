import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { family } from '../../../amaleh/scripts/family.ts';
import { MODELS } from '../../src/lib/models.ts';
import { heroScene } from '../../src/lib/hero-scene.ts';
import { WORKERS, REPAIR, DECISION } from '../../src/lib/pool.ts';

const here = fileURLToPath(new URL('../../../', import.meta.url));
const names = ['DeepSeek', 'GLM', 'MiMo', 'Stealth', 'Qwen Coder', 'Nemotron'];
const SIDES = ['top', 'right', 'bottom', 'left'];
const EPS = 1e-6;
const RING_SIDES = 2.5;
const CLEARANCE_SIDES = 0.15;
const OVERLAP_CROSS = 0.025;
const LABEL_MIN_RATIO = { wide: 0.0186, narrow: 0.0382 };
const HOST_MODELS = [
  { family: 'claude', name: 'Claude Code' },
  { family: 'openai', name: 'Codex' },
];
const DISPATCH_WEIGHT = 0.7;
const FIRST_WORKER_INDEX = 3;
const LABEL_DRAWN_GLYPH = 0.62;
const LABEL_PATCH_SLACK = 1.1;
const IDENTITY_FAMILY = new Map(Object.entries(MODELS).map(([key, value]) => [value, key]));

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const same = (a, b) => distance(a, b) < EPS;

function pointSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = length < EPS ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function segmentsCross(a, b, c, d) {
  const signs = [orient(a, b, c), orient(a, b, d), orient(c, d, a), orient(c, d, b)];
  if (!signs.some((value) => value > EPS) || !signs.some((value) => value < -EPS)) return false;
  return (signs[0] > EPS) !== (signs[1] > EPS) && (signs[2] > EPS) !== (signs[3] > EPS);
}

function segmentSegment(a, b, c, d) {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(pointSegment(a, c, d), pointSegment(b, c, d), pointSegment(c, a, b), pointSegment(d, a, b));
}

const cornersOf = (box) => [
  [box.x, box.y],
  [box.x + box.width, box.y],
  [box.x + box.width, box.y + box.height],
  [box.x, box.y + box.height],
];

function insideBox(p, box, shrink = 0) {
  return p[0] > box.x + shrink && p[0] < box.x + box.width - shrink && p[1] > box.y + shrink && p[1] < box.y + box.height - shrink;
}

function segmentBox(a, b, box) {
  if (insideBox(a, box) || insideBox(b, box)) return 0;
  const corners = cornersOf(box);
  let best = Infinity;
  for (let i = 0; i < 4; i += 1) best = Math.min(best, segmentSegment(a, b, corners[i], corners[(i + 1) % 4]));
  return best;
}

function entersBox(a, b, box, from) {
  for (let step = 1; step < 400; step += 1) {
    const t = step / 400;
    const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    if (from && distance(p, from) < 1e-3) continue;
    if (insideBox(p, box, 1e-6)) return true;
  }
  return false;
}

function entersCircle(a, b, centre, radius, from) {
  for (let step = 1; step < 400; step += 1) {
    const t = step / 400;
    const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    if (from && distance(p, from) < 1e-3) continue;
    if (distance(p, centre) < radius - 1e-6) return true;
  }
  return false;
}

const boxesOverlap = (a, b, gap) =>
  a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

const isBox = (box) => box && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(box[key])) && box.width > 0 && box.height > 0;

function syntheticPool(count) {
  return {
    workers: names.slice(0, count).map((name, index) => ({ family: `w${index}`, name })),
    deep: [{ family: 'kimi', name: 'Kimi' }],
    decision: { family: 'jev', name: 'Jev' },
  };
}

function nodesOf(scene) {
  const byRole = (role) => scene.nodes.filter((node) => node.role === role);
  return { hub: byRole('coordinator')[0], hosts: byRole('host'), workers: byRole('worker'), jev: byRole('decision')[0], kimi: byRole('deep')[0] };
}

function sideOf(node, point) {
  return SIDES.find((side) => same(node.ports[side], point));
}

function ports(failures, scene, ring, at) {
  for (const node of scene.nodes) {
    const name = node.label ?? node.role;
    if (!isBox(node.tile)) {
      failures.push(`${at}: ${name} has no tile box { x, y, width, height }`);
      continue;
    }
    if (!node.ports || SIDES.some((side) => !Array.isArray(node.ports[side]) || node.ports[side].length !== 2)) {
      failures.push(`${at}: ${name} carries no ports { top, right, bottom, left } as [x, y] points`);
      continue;
    }
    if (node === ring) {
      for (const side of SIDES) {
        const expected = { top: [node.x, node.y - node.r], right: [node.x + node.r, node.y], bottom: [node.x, node.y + node.r], left: [node.x - node.r, node.y] }[side];
        if (!same(node.ports[side], expected)) failures.push(`${at}: the coordinator ring's ${side} point is not on the ring at its ${side}`);
      }
      continue;
    }
    if (!isBox(node.labelBox)) {
      failures.push(`${at}: ${name} has no labelBox { x, y, width, height }`);
      continue;
    }
    const middle = node.tile.x + node.tile.width / 2;
    const expected = { top: [middle, node.tile.y], right: [node.tile.x + node.tile.width, node.tile.y + node.tile.height / 2], left: [node.tile.x, node.tile.y + node.tile.height / 2] };
    if (Math.abs(node.labelBox.x + node.labelBox.width / 2 - middle) > EPS) failures.push(`${at}: the label of ${name} is not centred under its tile`);
    if (node.labelBox.y < node.tile.y + node.tile.height - EPS) failures.push(`${at}: the label of ${name} starts above the bottom of its tile`);
    for (const side of ['top', 'right', 'left']) if (!same(node.ports[side], expected[side])) failures.push(`${at}: the ${side} point of ${name} is not the midpoint of its ${side} edge`);
    if (Math.abs(node.ports.bottom[0] - middle) > EPS || node.ports.bottom[1] < node.labelBox.y + node.labelBox.height - EPS) {
      failures.push(`${at}: the bottom point of ${name} is not on its axis at or below its label`);
    }
    if (scene.nodes.some((other) => other !== node && other.label && other.label === node.label)) failures.push(`${at}: ${name} is labelled like another node`);
  }
}

function boxesOf(scene, ring) {
  const boxes = [{ name: 'the coordinator ring', box: ring.tile, node: ring }];
  for (const node of scene.nodes) {
    if (node === ring) continue;
    boxes.push({ name: `the tile of ${node.label}`, box: node.tile, node });
    boxes.push({ name: `the label of ${node.label}`, box: node.labelBox, node });
  }
  return boxes;
}

function arrangement(failures, scene, direction, models, at) {
  const { hub, hosts, workers, jev, kimi } = models;
  const side = scene.nodes.find((node) => node.family).tile.width;
  const clearance = CLEARANCE_SIDES * side;
  if (Math.abs(hub.r * 2 - RING_SIDES * side) > 0.01 * side) {
    failures.push(`${at}: the coordinator ring's diameter is ${(hub.r * 2).toFixed(3)}, expected ${RING_SIDES} tile sides (${(RING_SIDES * side).toFixed(3)})`);
  }
  if (hub.family || hub.label || hub.labelBox) failures.push(`${at}: the coordinator ring carries a family, label or labelBox`);

  const boxes = boxesOf(scene, hub);
  for (const { name, box } of boxes) {
    if (box.x < -EPS || box.y < -EPS || box.x + box.width > scene.width + EPS || box.y + box.height > scene.height + EPS) {
      failures.push(`${at}: ${name} leaves the ${scene.width.toFixed(2)} by ${scene.height.toFixed(2)} scene box`);
    }
  }
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (boxes[i].node === boxes[j].node) continue;
      if (boxesOverlap(boxes[i].box, boxes[j].box, clearance)) {
        failures.push(`${at}: ${boxes[i].name} and ${boxes[j].name} are closer than ${clearance.toFixed(3)}`);
      }
    }
  }

  const ys = workers.map((node) => node.y);
  if (Math.max(...ys) - Math.min(...ys) > EPS) failures.push(`${at}: the workers are not in one row`);
  for (let i = 1; i < workers.length; i += 1) {
    if (!(workers[i].x > workers[i - 1].x)) failures.push(`${at}: ${workers[i].label} is not right of ${workers[i - 1].label}`);
    if (Math.abs(workers[i].x - workers[i - 1].x - (workers[1].x - workers[0].x)) > EPS) failures.push(`${at}: the workers are not evenly spaced`);
  }
  const rowTop = Math.min(...workers.map((node) => node.tile.y));
  const rowBottom = Math.max(...workers.map((node) => node.labelBox.y + node.labelBox.height));
  for (const host of hosts) {
    if (!(host.labelBox.y + host.labelBox.height < rowTop - EPS)) failures.push(`${at}: ${host.label} does not sit above the worker row`);
  }
  if (!(hosts[0].x < hosts[1].x)) failures.push(`${at}: Claude Code is not left of Codex`);
  for (const node of [jev, kimi]) {
    if (!(node.tile.y > rowBottom + EPS)) failures.push(`${at}: ${node.label} does not sit below the worker row`);
    if (Math.abs(node.y - jev.y) > EPS) failures.push(`${at}: ${node.label} does not share Jev's row`);
  }
  if (!(jev.x >= workers[0].x - EPS && jev.x <= workers.at(-1).x + EPS)) failures.push(`${at}: Jev is not between the first and last worker`);
  if (!(kimi.x > jev.x + EPS)) failures.push(`${at}: Kimi is not to the right of Jev`);

  if (direction === 'wide') {
    for (const node of scene.nodes.filter((candidate) => candidate !== hub)) {
      if (!(node.tile.x > hub.x + hub.r + EPS) || !(node.labelBox.x > hub.x + hub.r + EPS)) {
        failures.push(`${at}: ${node.label} is not entirely right of the coordinator ring`);
      }
    }
  } else {
    for (const node of scene.nodes.filter((candidate) => candidate !== hub)) {
      if (!(node.y > hub.y + EPS)) failures.push(`${at}: ${node.label} is not below the centre of the coordinator ring`);
      if (!(node.tile.y > hub.y - hub.r + EPS)) failures.push(`${at}: ${node.label} reaches above the top of the coordinator ring`);
    }
    if (!(rowTop > hub.y + hub.r + EPS)) failures.push(`${at}: the worker row is not below the coordinator ring`);
  }
}

function linksOf(failures, scene, direction, models, at) {
  const { hub, hosts, workers, jev, kimi } = models;
  const side = scene.nodes.find((node) => node.family).tile.width;
  const clearance = CLEARANCE_SIDES * side;
  const named = (index) => scene.nodes[index]?.label ?? scene.nodes[index]?.role;
  const ends = [];
  const seen = new Map();
  const phases = new Set();

  for (const link of scene.links) {
    const from = scene.nodes[link.from];
    const to = scene.nodes[link.to];
    if (!from || !to) {
      failures.push(`${at}: a link names a missing node`);
      continue;
    }
    const name = `${from.label ?? from.role} to ${to.label ?? to.role}`;
    const start = [link.x1, link.y1];
    const end = [link.x2, link.y2];
    const startSide = sideOf(from, start);
    const endSide = sideOf(to, end);
    if (!startSide || !endSide) {
      failures.push(`${at}: the link ${name} does not start and end on side points of its two nodes`);
      continue;
    }
    if (phases.has(link.phase)) failures.push(`${at}: the link ${name} shares its phase ${link.phase} with another link`);
    phases.add(link.phase);
    const key = [link.from, link.to].sort((a, b) => a - b).join('-');
    if (seen.has(key)) {
      if (seen.get(key) !== `${start}|${end}`) failures.push(`${at}: two links join ${named(link.from)} and ${named(link.to)} along different segments`);
      continue;
    }
    seen.set(key, `${start}|${end}`);
    ends.push({ from, to, start, end, startSide, endSide, name });
  }

  if (ends.length !== 3 * workers.length + 2) {
    failures.push(`${at}: ${ends.length} linked node pairs, expected ${3 * workers.length + 2}`);
  }

  const wanted = [
    ...hosts.map((host) => ({ a: host, b: hub, kind: 'coordinator', hueFamily: host.family, weight: 1, dispatch: false })),
    ...workers.map((worker) => ({ a: worker, b: hub, kind: 'coordinator', hueFamily: worker.family, weight: DISPATCH_WEIGHT, dispatch: true })),
    ...workers.map((worker) => ({ a: worker, b: jev, kind: 'decision', hueFamily: undefined, weight: 1, dispatch: false })),
    ...workers.slice(1).map((worker, index) => ({ a: workers[index], b: worker, kind: 'review', hueFamily: undefined, weight: 1, dispatch: false })),
    { a: workers.at(-1), b: kimi, kind: 'worker', hueFamily: kimi.family, weight: 1, dispatch: false },
  ];
  for (const { a, b, kind, hueFamily, weight, dispatch } of wanted) {
    const key = [a, b].map((node) => scene.nodes.indexOf(node)).sort((x, y) => x - y).join('-');
    const link = scene.links.find((candidate) => {
      const other = [candidate.from, candidate.to].sort((x, y) => x - y).join('-');
      return other === key;
    });
    if (!link) {
      failures.push(`${at}: no link joins ${a.label ?? a.role} and ${b.label ?? b.role}`);
      continue;
    }
    if (link.kind !== kind) failures.push(`${at}: the link ${a.label ?? a.role} to ${b.label ?? b.role} has kind ${link.kind}, expected ${kind}`);
    if (Math.abs(link.weight - weight) > EPS) failures.push(`${at}: the link ${a.label ?? a.role} to ${b.label ?? b.role} has weight ${link.weight}, expected ${weight}`);
    if (link.hueFamily !== hueFamily) failures.push(`${at}: the link ${a.label ?? a.role} to ${b.label ?? b.role} has hue family ${link.hueFamily}, expected ${hueFamily}`);
    if (dispatch && typeof link.returnPhase !== 'number') {
      failures.push(`${at}: the dispatch link to ${a.label} carries no returnPhase for an accepted chunk`);
    }
  }

  const sideAt = (end, node) => (end.from === node ? end.startSide : end.endSide);
  for (const end of ends) {
    const roles = [end.from.role, end.to.role];
    if (roles.includes('coordinator') && roles.includes('worker')) {
      const worker = end.from.role === 'worker' ? end.from : end.to;
      const wanted = direction === 'wide' ? 'right' : 'bottom';
      if (sideAt(end, hub) !== wanted) failures.push(`${at}: the dispatch line to ${worker.label} leaves the ring from its ${sideAt(end, hub)} point, expected its ${wanted} point`);
      if (sideAt(end, worker) !== 'top') failures.push(`${at}: the dispatch line reaches ${worker.label} at its ${sideAt(end, worker)} point, expected its top point`);
    }
    if (roles.includes('coordinator') && roles.includes('host')) {
      const host = end.from.role === 'host' ? end.from : end.to;
      if (direction === 'wide' && sideAt(end, hub) !== 'right') {
        failures.push(`${at}: the line from ${host.label} meets the ring at its ${sideAt(end, hub)} point, expected its right point`);
      }
      if (direction === 'narrow' && sideAt(end, host) !== (host === hosts[0] ? 'right' : 'left')) {
        failures.push(`${at}: the line from ${host.label} leaves its ${sideAt(end, host)} point, expected its ${host === hosts[0] ? 'right' : 'left'} point`);
      }
    }
    if (roles[0] === 'worker' && roles[1] === 'worker') {
      const [left, right] = end.from.x < end.to.x ? [end.from, end.to] : [end.to, end.from];
      if (sideAt(end, left) !== 'right' || sideAt(end, right) !== 'left') {
        failures.push(`${at}: the review line ${left.label} to ${right.label} does not run from the right point of ${left.label} to the left point of ${right.label}`);
      }
    }
    if (roles.includes('worker') && roles.includes('decision')) {
      const worker = end.from.role === 'worker' ? end.from : end.to;
      if (sideAt(end, worker) !== 'bottom' || sideAt(end, jev) !== 'top') {
        failures.push(`${at}: the decision line ${worker.label} to Jev does not run from the bottom point of ${worker.label} to the top point of Jev`);
      }
    }
    if (roles.includes('worker') && roles.includes('deep')) {
      const worker = end.from.role === 'worker' ? end.from : end.to;
      if (sideAt(end, worker) !== 'bottom' || sideAt(end, kimi) !== 'top') {
        failures.push(`${at}: the escalation line ${worker.label} to Kimi does not run from the bottom point of ${worker.label} to the top point of Kimi`);
      }
    }
  }

  const boxes = boxesOf(scene, hub);
  for (const end of ends) {
    for (const { name, box, node } of boxes) {
      if (node === end.from || node === end.to) continue;
      if (node === hub) {
        if (pointSegment([hub.x, hub.y], end.start, end.end) < hub.r + clearance) {
          failures.push(`${at}: the line ${end.name} passes within ${clearance.toFixed(3)} of the coordinator ring`);
        }
        continue;
      }
      if (segmentBox(end.start, end.end, box) < clearance) {
        failures.push(`${at}: the line ${end.name} passes within ${clearance.toFixed(3)} of ${name}`);
      }
    }
    for (const [node, from] of [[end.from, end.start], [end.to, end.end]]) {
      if (node === hub) {
        if (entersCircle(end.start, end.end, [hub.x, hub.y], hub.r, from)) failures.push(`${at}: the line ${end.name} runs through the coordinator ring`);
        continue;
      }
      if (entersBox(end.start, end.end, node.tile, from) || entersBox(end.start, end.end, node.labelBox, from)) {
        failures.push(`${at}: the line ${end.name} runs through the tile or label of ${node.label}`);
      }
    }
  }

  for (let i = 0; i < ends.length; i += 1) {
    for (let j = i + 1; j < ends.length; j += 1) {
      const a = ends[i];
      const b = ends[j];
      const shared = [a.start, a.end].find((point) => same(point, b.start) || same(point, b.end));
      if (shared) {
        const away = (end) => (same(end.start, shared) ? end.end : end.start);
        const u = [away(a)[0] - shared[0], away(a)[1] - shared[1]];
        const v = [away(b)[0] - shared[0], away(b)[1] - shared[1]];
        const cross = Math.abs(u[0] * v[1] - u[1] * v[0]) / (Math.hypot(...u) * Math.hypot(...v));
        if (cross < OVERLAP_CROSS && u[0] * v[0] + u[1] * v[1] > 0) {
          failures.push(`${at}: the lines ${a.name} and ${b.name} leave one point along the same direction and overlap`);
        }
        continue;
      }
      const gap = segmentSegment(a.start, a.end, b.start, b.end);
      if (gap < clearance) {
        failures.push(`${at}: the lines ${a.name} and ${b.name} ${gap < EPS ? 'cross' : `come within ${gap.toFixed(3)}`}, below ${clearance.toFixed(3)}`);
      }
    }
  }
}

function content(failures, scene, pool, models, at) {
  const { hub, hosts, workers, jev, kimi } = models;
  const index = new Map(scene.nodes.map((node, position) => [node, position]));
  const order = [hub, ...hosts, ...workers, jev, kimi];
  if (order.some((node, position) => scene.nodes[position] !== node)) {
    failures.push(`${at}: the nodes are not in the order coordinator, Claude Code, Codex, workers in pool order, decision, repair`);
  }
  scene.nodes.forEach((node, position) => {
    if (position >= FIRST_WORKER_INDEX && position < FIRST_WORKER_INDEX + workers.length) {
      const worker = pool.workers[position - FIRST_WORKER_INDEX];
      if (node.family !== worker.family || node.label !== worker.name) {
        failures.push(`${at}: node ${position} is ${node.family}/${node.label}, expected ${worker.family}/${worker.name}`);
      }
    }
  });
  if (index.size !== scene.nodes.length) failures.push(`${at}: the scene repeats a node`);
}

function labelSize(failures, direction, scene) {
  const ratio = scene.labelSize / scene.width;
  if (!(ratio >= LABEL_MIN_RATIO[direction])) {
    failures.push(`the real pool's ${direction} label size is ${ratio.toFixed(5)} of the scene width, below ${LABEL_MIN_RATIO[direction]}, so an 11 CSS pixel label needs a box wider than ${Math.round(11 / LABEL_MIN_RATIO[direction])} pixels`);
  }
  for (const node of scene.nodes) {
    if (!node.labelBox) continue;
    const drawn = node.label.length * scene.labelSize * LABEL_DRAWN_GLYPH;
    if (node.labelBox.width < drawn * LABEL_PATCH_SLACK) {
      failures.push(`the label patch of ${node.label} in the ${direction} layout is ${node.labelBox.width.toFixed(3)} wide, below 10% more than the ${drawn.toFixed(3)} its glyphs need`);
      break;
    }
  }
}

function geometry(failures) {
  for (const direction of ['wide', 'narrow']) {
    for (let count = 2; count <= 6; count += 1) {
      const at = `${count} workers, ${direction}`;
      const pool = syntheticPool(count);
      let scene;
      try {
        scene = heroScene(pool, direction);
      } catch (error) {
        failures.push(`${at}: heroScene threw ${error.message}`);
        continue;
      }
      if (scene.direction !== direction) failures.push(`${at}: the scene's direction is ${scene.direction}`);
      if (!(scene.width > 0 && scene.height > 0 && scene.labelSize > 0)) {
        failures.push(`${at}: the scene has no positive width, height and labelSize`);
        continue;
      }
      if (JSON.stringify(heroScene(pool, direction)) !== JSON.stringify(scene)) {
        failures.push(`${at}: two calls with the same pool return different scenes`);
      }
      const models = nodesOf(scene);
      if (!models.hub || models.hosts.length !== 2 || models.workers.length !== count || !models.jev || !models.kimi) {
        failures.push(`${at}: expected one coordinator, 2 hosts, ${count} workers, one decision and one repair node, found ${scene.nodes.length} nodes`);
        continue;
      }
      models.hosts.forEach((host, position) => {
        const wanted = HOST_MODELS[position];
        if (host.family !== wanted.family || host.label !== wanted.name) {
          failures.push(`${at}: host ${position} is ${host.family}/${host.label}, expected ${wanted.family}/${wanted.name}`);
        }
      });
      if (models.jev.family !== pool.decision.family || models.jev.label !== pool.decision.name) {
        failures.push(`${at}: the decision node is ${models.jev.family}/${models.jev.label}, expected ${pool.decision.family}/${pool.decision.name}`);
      }
      if (models.kimi.family !== pool.deep[0].family || models.kimi.label !== pool.deep[0].name) {
        failures.push(`${at}: the repair node is ${models.kimi.family}/${models.kimi.label}, expected ${pool.deep[0].family}/${pool.deep[0].name}`);
      }
      content(failures, scene, pool, models, at);
      ports(failures, scene, models.hub, at);
      arrangement(failures, scene, direction, models, at);
      linksOf(failures, scene, direction, models, at);
    }
  }

  const pool = {
    workers: WORKERS.map((worker) => ({ family: IDENTITY_FAMILY.get(worker), name: worker.name })),
    deep: [{ family: IDENTITY_FAMILY.get(REPAIR), name: REPAIR.name }],
    decision: { family: IDENTITY_FAMILY.get(DECISION), name: DECISION.name },
  };
  for (const direction of ['wide', 'narrow']) labelSize(failures, direction, heroScene(pool, direction));
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
  const heroes = [...html.matchAll(/<svg\b[^>]*data-hero-layout="([^"]+)"[^>]*>[\s\S]*?<\/svg>/g)]
    .map((match) => ({ layout: match[1], svg: match[0] }));
  const layouts = heroes.map((hero) => hero.layout).sort();
  if (layouts.length !== 2 || layouts[0] !== 'narrow' || layouts[1] !== 'wide') {
    failures.push(`/ has hero SVGs for the layouts [${layouts.join(', ')}], expected exactly one narrow and one wide`);
    return;
  }
  for (const hero of heroes) {
    const tiles = [...hero.svg.matchAll(/<g\b([^>]*\bdata-model="([^"]+)"[^>]*)>/g)].map((match, index, all) => ({
      attributes: match[1],
      family: match[2],
      body: hero.svg.slice(match.index, all[index + 1]?.index ?? hero.svg.length),
    }));
    const workerTiles = tiles.filter((tile) => /\bdata-role="worker"/.test(tile.attributes));
    const families = workerTiles.map((tile) => tile.family).sort();
    const wanted = expected.map((worker) => worker.family).sort();
    const same = families.length === wanted.length && families.every((value, index) => value === wanted[index]);
    if (!same) {
      failures.push(`the built ${hero.layout} hero worker tiles are [${families.join(', ')}], expected [${wanted.join(', ')}]`);
    }
    const text = (tile) => [...tile.body.matchAll(/<text\b[^>]*data-label[^>]*>([\s\S]*?)<\/text>/g)]
      .map((match) => match[1].replace(/<[^>]+>/g, '').trim());
    for (const worker of expected) {
      const tile = workerTiles.find((candidate) => candidate.family === worker.family);
      if (!tile) continue;
      const labels = text(tile).filter((value) => value.length > 0);
      if (!worker.name || !labels.includes(worker.name)) {
        failures.push(`the built ${hero.layout} hero tile ${worker.family} is labelled [${labels.join(', ')}], expected [${worker.name}]`);
      }
    }
  }
}

export default async function hero({ publicDir }) {
  const failures = [];
  geometry(failures);
  built(failures, publicDir);
  return failures;
}
