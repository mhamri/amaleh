import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { family } from '../../../amaleh/scripts/family.ts';
import { MODELS } from '../../src/lib/models.ts';
import { heroScene, linkPoint } from '../../src/lib/hero-scene.ts';
import { emptyFrame, fillFrame, heroStory, NO_HEAD, STILL_SECONDS } from '../../src/lib/hero-story.ts';
import { WORKERS, REPAIR, DECISION } from '../../src/lib/pool.ts';

const here = fileURLToPath(new URL('../../../', import.meta.url));
const names = ['DeepSeek', 'GLM', 'MiMo', 'Stealth', 'Qwen Coder', 'Nemotron'];
const SIDES = ['top', 'right', 'bottom', 'left'];
const EPS = 1e-6;
const RING_SIDES = 2.5;
const CLEARANCE_SIDES = 0.15;
const OVERLAP_CROSS = 0.025;
const CURVE_SAMPLES = 48;
const STORY_STEP_SECONDS = 0.05;
const LABEL_MIN_RATIO = { wide: 0.0186, narrow: 0.0382 };
const HOST_MODELS = [
  { family: 'claude', name: 'Claude Code' },
  { family: 'openai', name: 'Codex' },
];
const DISPATCH_WEIGHT = 0.7;
const FIRST_WORKER_INDEX = 3;
const LABEL_DRAWN_GLYPH = 0.62;
const LABEL_BOX_SLACK = 1.1;
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

const curveOf = (link) => Array.from({ length: CURVE_SAMPLES + 1 }, (_, step) => linkPoint(link, step / CURVE_SAMPLES));

function curveBox(curve, box) {
  let best = Infinity;
  for (let i = 1; i < curve.length; i += 1) best = Math.min(best, segmentBox(curve[i - 1], curve[i], box));
  return best;
}

function curvePoint(curve, point) {
  let best = Infinity;
  for (let i = 1; i < curve.length; i += 1) best = Math.min(best, pointSegment(point, curve[i - 1], curve[i]));
  return best;
}

function curveCurve(a, b) {
  let best = Infinity;
  for (let i = 1; i < a.length; i += 1) {
    for (let j = 1; j < b.length; j += 1) best = Math.min(best, segmentSegment(a[i - 1], a[i], b[j - 1], b[j]));
  }
  return best;
}

function curvesCross(a, b) {
  for (let i = 1; i < a.length; i += 1) {
    for (let j = 1; j < b.length; j += 1) if (segmentsCross(a[i - 1], a[i], b[j - 1], b[j])) return true;
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
  const named = (node) => node.label ?? node.role;
  const centre = [hub.x, hub.y];
  const onRing = (point) => Math.abs(distance(point, centre) - hub.r) < EPS;
  const ends = [];
  const seen = new Set();

  for (const link of scene.links) {
    const from = scene.nodes[link.from];
    const to = scene.nodes[link.to];
    if (!from || !to) {
      failures.push(`${at}: a link names a missing node`);
      continue;
    }
    const name = `${named(from)} to ${named(to)}`;
    const start = [link.x1, link.y1];
    const end = [link.x2, link.y2];
    const control = [link.cx, link.cy];
    if (![...start, ...end, ...control].every(Number.isFinite)) {
      failures.push(`${at}: the link ${name} carries no finite start, control and end point`);
      continue;
    }
    const startSide = from === hub ? (onRing(start) ? 'ring' : undefined) : sideOf(from, start);
    const endSide = to === hub ? (onRing(end) ? 'ring' : undefined) : sideOf(to, end);
    if (!startSide || !endSide) {
      failures.push(`${at}: the link ${name} does not start and end on a side point of a tile or on the coordinator ring`);
      continue;
    }
    const key = [link.from, link.to].sort((a, b) => a - b).join('-');
    if (seen.has(key)) {
      failures.push(`${at}: two links join ${named(from)} and ${named(to)}`);
      continue;
    }
    seen.add(key);
    ends.push({ link, from, to, start, end, control, startSide, endSide, name, curve: curveOf(link) });
  }

  if (ends.length !== 3 * workers.length + 2) {
    failures.push(`${at}: ${ends.length} linked node pairs, expected ${3 * workers.length + 2}`);
  }

  const wanted = [
    ...hosts.map((host) => ({ a: host, b: hub, kind: 'host', hueFamily: host.family, weight: 1 })),
    ...workers.map((worker) => ({ a: worker, b: hub, kind: 'dispatch', hueFamily: worker.family, weight: DISPATCH_WEIGHT })),
    ...workers.map((worker) => ({ a: worker, b: jev, kind: 'decision', hueFamily: undefined, weight: 1 })),
    ...workers.slice(1).map((worker, index) => ({ a: workers[index], b: worker, kind: 'review', hueFamily: undefined, weight: 1 })),
    { a: workers.at(-1), b: kimi, kind: 'escalation', hueFamily: kimi.family, weight: 1 },
  ];
  for (const { a, b, kind, hueFamily, weight } of wanted) {
    const end = ends.find((candidate) => (candidate.from === a && candidate.to === b) || (candidate.from === b && candidate.to === a));
    if (!end) {
      failures.push(`${at}: no link joins ${named(a)} and ${named(b)}`);
      continue;
    }
    if (end.link.kind !== kind) failures.push(`${at}: the link ${named(a)} to ${named(b)} has kind ${end.link.kind}, expected ${kind}`);
    if (Math.abs(end.link.weight - weight) > EPS) failures.push(`${at}: the link ${named(a)} to ${named(b)} has weight ${end.link.weight}, expected ${weight}`);
    if (end.link.hueFamily !== hueFamily) failures.push(`${at}: the link ${named(a)} to ${named(b)} has hue family ${end.link.hueFamily}, expected ${hueFamily}`);
  }

  const sideAt = (end, node) => (end.from === node ? end.startSide : end.endSide);
  const pointAt = (end, node) => (end.from === node ? end.start : end.end);
  for (const end of ends) {
    const roles = [end.from.role, end.to.role];
    if (roles.includes('coordinator') && roles.includes('worker')) {
      const worker = end.from.role === 'worker' ? end.from : end.to;
      const point = pointAt(end, hub);
      if (direction === 'wide' && !(point[0] > hub.x && point[1] > hub.y)) {
        failures.push(`${at}: the dispatch line to ${worker.label} does not leave the ring from its lower right arc`);
      }
      if (direction === 'narrow' && !(point[1] > hub.y)) {
        failures.push(`${at}: the dispatch line to ${worker.label} does not leave the ring from its lower arc`);
      }
      if (sideAt(end, worker) !== 'top') failures.push(`${at}: the dispatch line reaches ${worker.label} at its ${sideAt(end, worker)} point, expected its top point`);
    }
    if (roles.includes('coordinator') && roles.includes('host')) {
      const host = end.from.role === 'host' ? end.from : end.to;
      const point = pointAt(end, hub);
      const expected = direction === 'wide' ? (host === hosts[0] ? 'left' : 'bottom') : host === hosts[0] ? 'right' : 'left';
      if (sideAt(end, host) !== expected) {
        failures.push(`${at}: the line from ${host.label} leaves its ${sideAt(end, host)} point, expected its ${expected} point`);
      }
      if (direction === 'wide' && !(point[0] > hub.x && point[1] < hub.y)) {
        failures.push(`${at}: the line from ${host.label} does not meet the ring on its upper right arc`);
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

  const ringEnds = ends.filter((end) => end.from === hub || end.to === hub);
  for (let i = 0; i < ringEnds.length; i += 1) {
    for (let j = i + 1; j < ringEnds.length; j += 1) {
      const gap = distance(pointAt(ringEnds[i], hub), pointAt(ringEnds[j], hub));
      if (gap < clearance) {
        failures.push(`${at}: the lines ${ringEnds[i].name} and ${ringEnds[j].name} meet the ring ${gap.toFixed(3)} apart, below ${clearance.toFixed(3)}`);
      }
    }
  }

  const boxes = boxesOf(scene, hub);
  for (const end of ends) {
    const inner = end.curve.slice(1, -1);
    if (end.curve.some((point) => point[0] < -EPS || point[1] < -EPS || point[0] > scene.width + EPS || point[1] > scene.height + EPS)) {
      failures.push(`${at}: the line ${end.name} leaves the ${scene.width.toFixed(2)} by ${scene.height.toFixed(2)} scene box`);
    }
    for (const { name, box, node } of boxes) {
      if (node === end.from || node === end.to) continue;
      if (node === hub) {
        if (curvePoint(end.curve, centre) < hub.r + clearance) {
          failures.push(`${at}: the line ${end.name} passes within ${clearance.toFixed(3)} of the coordinator ring`);
        }
        continue;
      }
      if (curveBox(end.curve, box) < clearance) {
        failures.push(`${at}: the line ${end.name} passes within ${clearance.toFixed(3)} of ${name}`);
      }
    }
    for (const node of [end.from, end.to]) {
      if (node === hub) {
        if (inner.some((point) => distance(point, centre) < hub.r - EPS)) failures.push(`${at}: the line ${end.name} runs through the coordinator ring`);
        continue;
      }
      if (inner.some((point) => insideBox(point, node.tile, EPS) || insideBox(point, node.labelBox, EPS))) {
        failures.push(`${at}: the line ${end.name} runs through the tile or label of ${node.label}`);
      }
    }
  }

  const leaving = (end, point) => {
    const away = same(end.control, point) ? (same(end.start, point) ? end.end : end.start) : end.control;
    return [away[0] - point[0], away[1] - point[1]];
  };
  for (let i = 0; i < ends.length; i += 1) {
    for (let j = i + 1; j < ends.length; j += 1) {
      const a = ends[i];
      const b = ends[j];
      const sharesNode = a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to;
      if (!sharesNode) {
        const gap = curveCurve(a.curve, b.curve);
        if (gap < clearance) {
          failures.push(`${at}: the lines ${a.name} and ${b.name} ${gap < EPS ? 'cross' : `come within ${gap.toFixed(3)}`}, below ${clearance.toFixed(3)}`);
        }
        continue;
      }
      if (curvesCross(a.curve, b.curve)) failures.push(`${at}: the lines ${a.name} and ${b.name} share a node and cross`);
      const shared = [a.start, a.end].find((point) => same(point, b.start) || same(point, b.end));
      if (!shared) continue;
      const u = leaving(a, shared);
      const v = leaving(b, shared);
      const cross = Math.abs(u[0] * v[1] - u[1] * v[0]) / (Math.hypot(...u) * Math.hypot(...v));
      if (cross < OVERLAP_CROSS && u[0] * v[0] + u[1] * v[1] > 0) {
        failures.push(`${at}: the lines ${a.name} and ${b.name} leave one point along the same direction and overlap`);
      }
    }
  }
}

function story(failures, scene, models, at) {
  const { workers, jev, kimi } = models;
  let told;
  try {
    told = heroStory(scene);
  } catch (error) {
    failures.push(`${at}: heroStory threw ${error.message}`);
    return;
  }
  if (!(told.length > 0)) {
    failures.push(`${at}: the story has no positive length`);
    return;
  }
  const indexOf = (node) => scene.nodes.indexOf(node);
  const travels = told.beats.filter((beat) => beat.kind === 'travel');
  for (const beat of told.beats) {
    const end = beat.end ?? beat.start;
    if (!(beat.start >= 0 && end >= beat.start && end <= told.length)) {
      failures.push(`${at}: a ${beat.kind} beat runs from ${beat.start} to ${end}, outside the ${told.length.toFixed(2)} second story`);
    }
    if (beat.kind === 'travel' && !scene.links[beat.link]) failures.push(`${at}: a travel beat names the missing link ${beat.link}`);
    if ('node' in beat && !scene.nodes[beat.node]) failures.push(`${at}: a ${beat.kind} beat names the missing node ${beat.node}`);
  }
  for (let i = 0; i < travels.length; i += 1) {
    for (let j = i + 1; j < travels.length; j += 1) {
      if (travels[i].link === travels[j].link && travels[i].start < travels[j].end && travels[j].start < travels[i].end) {
        failures.push(`${at}: two packets travel link ${travels[i].link} at the same time`);
      }
    }
  }

  const builds = workers.map((worker) =>
    travels.filter((beat) => scene.links[beat.link].kind === 'dispatch' && scene.links[beat.link].to === indexOf(worker) && beat.direction === 1).length,
  );
  if (builds.some((value) => value !== 1)) {
    failures.push(`${at}: the story dispatches a chunk to each worker [${builds.join(', ')}] times, expected once each`);
  }
  const accepted = told.beats.filter((beat) => beat.kind === 'accept').map((beat) => beat.segment).sort((a, b) => a - b);
  if (accepted.length !== workers.length || accepted.some((segment, position) => segment !== position)) {
    failures.push(`${at}: the story accepts the ring segments [${accepted.join(', ')}], expected one for each of the ${workers.length} workers`);
  }
  const returns = travels.filter((beat) => scene.links[beat.link].kind === 'dispatch' && beat.direction === -1).length;
  if (returns !== workers.length) failures.push(`${at}: ${returns} chunks return to the ring, expected ${workers.length}`);
  const reviews = travels.filter((beat) => scene.links[beat.link].kind === 'review').length;
  if (reviews !== workers.length) failures.push(`${at}: ${reviews} chunks cross to a reviewer, expected ${workers.length}`);
  const questions = travels.filter((beat) => scene.links[beat.link].kind === 'decision' && scene.links[beat.link].to === indexOf(jev));
  if (questions.length !== 2 * workers.length) failures.push(`${at}: ${questions.length} question trips to Jev, expected one out and one back for each of the ${workers.length} workers`);
  const failed = told.beats.filter((beat) => beat.kind === 'verdict' && !beat.passed);
  const repairs = told.beats.filter((beat) => beat.kind === 'work' && beat.node === indexOf(kimi));
  const escalations = travels.filter((beat) => scene.links[beat.link].kind === 'escalation');
  if (failed.length !== 1 || repairs.length !== 1 || escalations.length !== 2) {
    failures.push(`${at}: the story holds ${failed.length} failed reviews, ${repairs.length} repairs by Kimi and ${escalations.length} escalation trips, expected 1, 1 and 2`);
  } else if (!(failed[0].start <= escalations[0].start && escalations[0].end <= repairs[0].start && repairs[0].end <= escalations[1].start)) {
    failures.push(`${at}: the failed review, the trip to Kimi, the repair and the trip back are not in that order`);
  }

  const frame = emptyFrame(scene);
  const inRange = (values) => [...values].every((value) => value >= -EPS && value <= 1 + EPS);
  for (let seconds = 0; seconds < told.length; seconds += STORY_STEP_SECONDS) {
    fillFrame(told, seconds, frame);
    const heads = [...frame.linkHead].filter((head) => head !== NO_HEAD);
    const levels = [heads, frame.linkLevel, frame.nodeLevel, frame.nodeVerdict, frame.segments, [frame.pulse]];
    if (!levels.every(inRange)) {
      failures.push(`${at}: the story frame at ${seconds.toFixed(2)} seconds holds a value outside 0 to 1`);
      break;
    }
  }
  const still = fillFrame(told, STILL_SECONDS, emptyFrame(scene));
  const flying = [...still.linkHead].filter((head) => head > 0.2 && head < 0.8).length;
  if (flying !== 1) failures.push(`${at}: the still frame at ${STILL_SECONDS} seconds shows ${flying} chunks in mid-flight, expected 1`);
  const again = fillFrame(told, STILL_SECONDS + told.length, emptyFrame(scene));
  if ([...still.linkHead].some((head, index) => Math.abs(head - again.linkHead[index]) > 1e-3)) {
    failures.push(`${at}: the story does not repeat after its ${told.length.toFixed(2)} second length`);
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
    if (node.labelBox.width < drawn * LABEL_BOX_SLACK) {
      failures.push(`the label box of ${node.label} in the ${direction} layout is ${node.labelBox.width.toFixed(3)} wide, below 10% more than the ${drawn.toFixed(3)} its glyphs need`);
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
      story(failures, scene, models, at);
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
    const curves = [...hero.svg.matchAll(/<path\b[^>]*\bdata-link="[^"]+"[^>]*>/g)].length;
    const segments = [...hero.svg.matchAll(/<path\b[^>]*\bdata-segment="[^"]+"[^>]*>/g)].length;
    const packets = [...hero.svg.matchAll(/<circle\b[^>]*\bdata-packet\b[^>]*>/g)].length;
    if (curves !== 3 * expected.length + 2) {
      failures.push(`the built ${hero.layout} hero draws ${curves} link curves, expected ${3 * expected.length + 2}`);
    }
    if (segments !== expected.length) {
      failures.push(`the built ${hero.layout} hero draws ${segments} ring segments, expected one for each of the ${expected.length} workers`);
    }
    if (packets !== 1) failures.push(`the built ${hero.layout} hero draws ${packets} still chunks, expected 1`);
    if (/data-label-patch/.test(hero.svg)) failures.push(`the built ${hero.layout} hero still draws a box behind a label`);
  }
}

export default async function hero({ publicDir }) {
  const failures = [];
  geometry(failures);
  built(failures, publicDir);
  return failures;
}
