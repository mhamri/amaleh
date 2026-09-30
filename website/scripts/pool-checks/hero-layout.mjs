import { layoutHero } from '../../src/lib/hero-layout.ts';

const NAMES = ['DeepSeek', 'GLM', 'MiMo', 'Stealth', 'Qwen Coder', 'Nemotron'];
const MAX_POOL = 6;
const EPS = 1e-6;
const SIDES = ['top', 'right', 'bottom', 'left'];
const CLEARANCE = 0.15;
const SEPARATION = 0.1;

const right = (box) => box.x + box.width;
const bottom = (box) => box.y + box.height;
const centre = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const same = (a, b) => Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS;
const boxesOf = (node) => (node.labelBox ? [node.tile, node.labelBox] : [node.tile]);
const kindOf = (node, index) => (index === 0 ? 'tile' : 'label');
const inflate = (box, by) => ({ x: box.x - by, y: box.y - by, width: box.width + 2 * by, height: box.height + 2 * by });
const tileSide = (scene) => scene.nodes.find((node) => node.role === 'worker').tile.width;

function segments(link) {
  const out = [];
  for (let at = 1; at < link.points.length; at += 1) {
    out.push({ a: link.points[at - 1], b: link.points[at] });
  }
  return out;
}

function segmentMeetsBox({ a, b }, box, open) {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  if (open) return x1 > box.x + EPS && x0 < right(box) - EPS && y1 > box.y + EPS && y0 < bottom(box) - EPS;
  return x1 >= box.x - EPS && x0 <= right(box) + EPS && y1 >= box.y - EPS && y0 <= bottom(box) + EPS;
}

function segmentsMeet(one, other) {
  const box = (segment) => ({
    x0: Math.min(segment.a.x, segment.b.x),
    x1: Math.max(segment.a.x, segment.b.x),
    y0: Math.min(segment.a.y, segment.b.y),
    y1: Math.max(segment.a.y, segment.b.y),
  });
  const oneBox = box(one);
  const otherBox = box(other);
  return oneBox.x0 <= otherBox.x1 + EPS && otherBox.x0 <= oneBox.x1 + EPS
    && oneBox.y0 <= otherBox.y1 + EPS && otherBox.y0 <= oneBox.y1 + EPS;
}

function leaves(side, from, to) {
  if (side === 'right') return to.x > from.x + EPS && Math.abs(to.y - from.y) <= EPS;
  if (side === 'left') return to.x < from.x - EPS && Math.abs(to.y - from.y) <= EPS;
  if (side === 'top') return to.y < from.y - EPS && Math.abs(to.x - from.x) <= EPS;
  return to.y > from.y + EPS && Math.abs(to.x - from.x) <= EPS;
}

function sideAt(node, point) {
  return SIDES.find((side) => node.ports?.[side] && same(node.ports[side], point));
}

function pool(size) {
  return {
    workers: NAMES.slice(0, size).map((name, index) => ({ family: `w${index}`, name })),
    deep: { family: 'kimi', name: 'Kimi' },
    decision: { family: 'jev', name: 'Jev' },
  };
}

function name(scene, id) {
  return scene.nodes.find((node) => node.id === id)?.label ?? 'the hub';
}

async function inspect(failures, size, direction) {
  const at = `${direction} hero layout with ${size} workers`;
  const wanted = pool(size);
  let scene;
  try {
    scene = await layoutHero(wanted, direction);
  } catch (error) {
    failures.push(`${at}: layoutHero threw ${error.message}`);
    return;
  }
  const again = await layoutHero(wanted, direction);
  if (JSON.stringify(again) !== JSON.stringify(scene)) {
    failures.push(`${at}: two calls with the same pool returned different scenes`);
  }

  const byId = new Map(scene.nodes.map((node) => [node.id, node]));
  const role = (kind) => scene.nodes.filter((node) => node.role === kind);
  const hub = role('coordinator')[0];
  const hosts = role('host');
  const workers = role('worker');
  const decisions = role('decision');
  const deeps = role('deep');
  if (!hub || hosts.length !== 2 || workers.length !== size || decisions.length !== 1 || deeps.length !== 1) {
    failures.push(`${at}: the scene must hold the coordinator hub, both hosts, ${size} workers, Jev and Kimi`);
    return;
  }
  if (scene.nodes.length !== size + 5) {
    failures.push(`${at}: the scene holds ${scene.nodes.length} nodes, expected ${size + 5}`);
  }
  if (scene.links.length !== 3 * size + 2) {
    failures.push(`${at}: the scene holds ${scene.links.length} links, expected ${3 * size + 2}`);
  }
  const side = tileSide(scene);
  const clearance = side * CLEARANCE;
  const separation = side * SEPARATION;

  for (const node of scene.nodes) {
    const label = node.label ?? 'the hub';
    const tile = centre(node.tile);
    if (node !== hub) {
      if (!node.family || !node.label || !node.labelBox) {
        failures.push(`${at}: ${label} needs a family, a label and a label box`);
        continue;
      }
      if (Math.abs(centre(node.labelBox).x - tile.x) > EPS) {
        failures.push(`${at}: the label of ${label} is not centred under its tile`);
      }
      if (node.labelBox.y < bottom(node.tile) - EPS) {
        failures.push(`${at}: the label of ${label} starts above the bottom of its tile`);
      }
      if (node.labelBox.height < scene.labelSize - EPS) {
        failures.push(`${at}: the label box of ${label} is shorter than scene.labelSize`);
      }
      if (node.labelBox.width < [...node.label].length * scene.labelSize * 0.5 - EPS) {
        failures.push(`${at}: the label box of ${label} is narrower than half an em per character`);
      }
      if (node.ports.bottom.y < bottom(node.labelBox) - EPS) {
        failures.push(`${at}: the bottom side point of ${label} sits above the bottom of its label`);
      }
    } else if (node.ports.bottom.y < bottom(node.tile) - EPS) {
      failures.push(`${at}: the bottom side point of the hub sits above the bottom of its tile`);
    }
    if (!same(node.ports.top, { x: tile.x, y: node.tile.y })
      || !same(node.ports.right, { x: right(node.tile), y: tile.y })
      || !same(node.ports.left, { x: node.tile.x, y: tile.y })) {
      failures.push(`${at}: ${label} does not carry one side point at the midpoint of each of its top, right and left tile edges`);
    }
    for (const box of boxesOf(node)) {
      if (box.x < -EPS || box.y < -EPS || right(box) > scene.width + EPS || bottom(box) > scene.height + EPS) {
        failures.push(`${at}: the ${kindOf(node, boxesOf(node).indexOf(box))} of ${label} leaves the ${scene.width} x ${scene.height} scene`);
      }
    }
  }

  const drawn = scene.nodes.flatMap((node) => boxesOf(node).map((box, index) => ({ node, box, kind: kindOf(node, index) })));
  for (let one = 0; one < drawn.length; one += 1) {
    for (let other = 0; other < drawn.length; other += 1) {
      if (one === other || drawn[one].node === drawn[other].node) continue;
      const diagonal = {
        a: { x: drawn[one].box.x, y: drawn[one].box.y },
        b: { x: right(drawn[one].box), y: bottom(drawn[one].box) },
      };
      if (segmentMeetsBox(diagonal, inflate(drawn[other].box, separation), true)) {
        failures.push(`${at}: the ${drawn[one].kind} of ${name(scene, drawn[one].node.id)} comes within ${separation} of the ${drawn[other].kind} of ${name(scene, drawn[other].node.id)}`);
      }
    }
  }

  const along = direction === 'wide' ? 'y' : 'x';
  const count = (kind, from, to) => scene.links.filter((link) => link.kind === kind && link.from === from && link.to === to).length;
  if (hosts.some((host) => host.label !== (host === hosts[0] ? 'Claude Code' : 'Codex'))) {
    failures.push(`${at}: the two hosts must be Claude Code and Codex`);
  }
  if (decisions[0].label !== wanted.decision.name || decisions[0].family !== wanted.decision.family
    || deeps[0].label !== wanted.deep.name || deeps[0].family !== wanted.deep.family) {
    failures.push(`${at}: the scene must carry ${wanted.decision.family}/${wanted.decision.name} and ${wanted.deep.family}/${wanted.deep.name} from the pool`);
  }
  for (const host of hosts) {
    if (count('host', host.id, hub.id) !== 1) failures.push(`${at}: expected one host link from ${host.label} to the coordinator hub`);
  }
  for (const worker of workers) {
    if (count('dispatch', hub.id, worker.id) !== 1) failures.push(`${at}: expected one dispatch link from the coordinator hub to ${worker.label}`);
    if (count('decision', worker.id, decisions[0].id) !== 1) failures.push(`${at}: expected one decision link from ${worker.label} to ${decisions[0].label}`);
  }
  const escalations = scene.links.filter((link) => link.kind === 'escalation');
  if (escalations.length !== 1 || escalations[0].from !== workers[workers.length - 1].id || escalations[0].to !== deeps[0].id) {
    failures.push(`${at}: expected one escalation link from ${workers[workers.length - 1].label} to ${deeps[0].label}`);
  }
  const ordered = [...workers].sort((one, other) => centre(one.tile)[along] - centre(other.tile)[along]);
  const reviews = scene.links.filter((link) => link.kind === 'review');
  if (reviews.length !== size - 1) {
    failures.push(`${at}: the scene holds ${reviews.length} review links, expected ${size - 1}`);
  }
  ordered.slice(1).forEach((worker, index) => {
    const lead = ordered[index];
    if (!reviews.some((link) => (link.from === lead.id && link.to === worker.id) || (link.from === worker.id && link.to === lead.id))) {
      failures.push(`${at}: no review link joins the neighbouring workers ${lead.label} and ${worker.label}`);
    }
  });
  if (new Set(scene.links.map((link) => link.id)).size !== scene.links.length) {
    failures.push(`${at}: two links share an id`);
  }
  workers.forEach((node, index) => {
    if (node.label !== wanted.workers[index].name || node.family !== wanted.workers[index].family) {
      failures.push(`${at}: worker ${index + 1} is ${node.family}/${node.label}, expected ${wanted.workers[index].family}/${wanted.workers[index].name}`);
    }
    if (index > 0 && centre(node.tile)[along] <= centre(workers[index - 1].tile)[along] + EPS) {
      failures.push(`${at}: the workers do not run in pool order ${direction === 'wide' ? 'top to bottom' : 'left to right'}`);
    }
  });

  const reach = (nodes, edge) => Math.max(...nodes.flatMap((node) => boxesOf(node).map(edge)));
  const start = (nodes, edge) => Math.min(...nodes.flatMap((node) => boxesOf(node).map(edge)));
  const group = [hub, ...hosts];
  const tail = [...decisions, ...deeps];
  const flow = direction === 'wide'
    ? { reach: right, start: (box) => box.x }
    : { reach: bottom, start: (box) => box.y };
  if (!(reach(group, flow.reach) < start([...workers, ...tail], flow.start))) {
    failures.push(`${at}: the coordinator hub and both hosts must sit ${direction === 'wide' ? 'left of' : 'above'} every worker, Jev and Kimi`);
  }
  if (!(reach(workers, flow.reach) < start(tail, flow.start))) {
    failures.push(`${at}: every worker must sit ${direction === 'wide' ? 'left of' : 'above'} Jev and Kimi`);
  }

  for (const link of scene.links) {
    const from = byId.get(link.from);
    const to = byId.get(link.to);
    const title = `the ${link.kind} link from ${name(scene, link.from)} to ${name(scene, link.to)}`;
    if (!from || !to) {
      failures.push(`${at}: ${title} names a node the scene does not hold`);
      continue;
    }
    if (link.points.length < 2) {
      failures.push(`${at}: ${title} needs at least two points`);
      continue;
    }
    if (link.kind === 'review' && link.points.length !== 2) {
      failures.push(`${at}: ${title} must be one straight segment`);
    }
    const parts = segments(link);
    parts.forEach(({ a, b }, index) => {
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      if (dx > EPS && dy > EPS) failures.push(`${at}: segment ${index + 1} of ${title} is not horizontal or vertical`);
      if (dx <= EPS && dy <= EPS) failures.push(`${at}: segment ${index + 1} of ${title} has no length`);
    });
    const first = link.points[0];
    const last = link.points.at(-1);
    const fromSide = sideAt(from, first);
    const toSide = sideAt(to, last);
    if (!fromSide) failures.push(`${at}: ${title} starts off the side points of ${name(scene, link.from)}`);
    else if (!leaves(fromSide, first, link.points[1])) failures.push(`${at}: ${title} does not leave ${name(scene, link.from)} straight out of its ${fromSide} side`);
    if (!toSide) failures.push(`${at}: ${title} ends off the side points of ${name(scene, link.to)}`);
    else if (!leaves(toSide, last, link.points.at(-2))) failures.push(`${at}: ${title} does not arrive at ${name(scene, link.to)} straight into its ${toSide} side`);
    for (const point of link.points) {
      if (point.x < -EPS || point.y < -EPS || point.x > scene.width + EPS || point.y > scene.height + EPS) {
        failures.push(`${at}: ${title} leaves the ${scene.width} x ${scene.height} scene`);
      }
    }
    for (const part of parts) {
      for (const node of scene.nodes) {
        const own = node === from || node === to;
        boxesOf(node).forEach((box, index) => {
          const kind = kindOf(node, index);
          if (own && segmentMeetsBox(part, box, true)) failures.push(`${at}: ${title} runs through the ${kind} of ${name(scene, node.id)}`);
          if (!own && segmentMeetsBox(part, inflate(box, clearance), false)) failures.push(`${at}: ${title} passes within ${clearance.toFixed(2)} of the ${kind} of ${name(scene, node.id)}`);
        });
      }
    }
  }

  for (let one = 0; one < scene.links.length; one += 1) {
    for (let other = one + 1; other < scene.links.length; other += 1) {
      const first = scene.links[one];
      const second = scene.links[other];
      if ([first.from, first.to].some((id) => id === second.from || id === second.to)) continue;
      if (segments(first).some((part) => segments(second).some((otherPart) => segmentsMeet(part, otherPart)))) {
        failures.push(`${at}: the ${first.kind} link from ${name(scene, first.from)} to ${name(scene, first.to)} touches the ${second.kind} link from ${name(scene, second.from)} to ${name(scene, second.to)}, and they share no node`);
      }
    }
  }
}

export default async function heroLayout({ publicDir }) {
  const failures = [];
  for (const direction of ['wide', 'narrow']) {
    for (let size = 2; size <= MAX_POOL; size += 1) {
      await inspect(failures, size, direction);
    }
  }
  return failures;
}
