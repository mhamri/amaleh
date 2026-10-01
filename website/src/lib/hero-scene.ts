export type SceneModel = { family: string; name: string };

export type SceneRole = 'coordinator' | 'host' | 'worker' | 'decision' | 'deep';

export type SceneDirection = 'wide' | 'narrow';

export type SceneSide = 'top' | 'right' | 'bottom' | 'left';

export type ScenePoint = [number, number];

export type SceneBox = { x: number; y: number; width: number; height: number };

export type SceneNode = {
  x: number;
  y: number;
  r: number;
  role: SceneRole;
  family?: string;
  label?: string;
  tile: SceneBox;
  labelBox?: SceneBox;
  ports: Record<SceneSide, ScenePoint>;
};

export type SceneLinkKind = 'host' | 'dispatch' | 'review' | 'decision' | 'escalation';

export type SceneLink = {
  from: number;
  to: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  x2: number;
  y2: number;
  kind: SceneLinkKind;
  weight: number;
  near: boolean;
  hueFamily?: string;
};

export type ScenePool = { workers: SceneModel[]; deep: SceneModel[]; decision: SceneModel };

export type Scene = {
  direction: SceneDirection;
  width: number;
  height: number;
  labelSize: number;
  nodes: SceneNode[];
  links: SceneLink[];
};

export const TILE = { side: 0.72, half: 0.36, radius: 0.18 };

const HUB_RADIUS = 0.9;
const TILE_RADIUS = 0.42;
const MARGIN = 0.3;
const LABEL_GAP = 0.2;
const LABEL_BOX_SCALE = 1.6;
const LABEL_GLYPH = 0.62;
const LABEL_PAD = 0.8;
const PORT_DROP = 0.06;
const LABEL_SIZE: Record<SceneDirection, number> = { wide: 0.18, narrow: 0.22 };
const MIN_SPACING: Record<SceneDirection, number> = { wide: 1.7, narrow: 1.2 };
const LABEL_NEIGHBOUR_GAP = 0.2;
const HOST_ROW_GAP = 0.6;
const HOST_MIN_GAP = 2.6;
const HOST_LEFT_GAP = 0.35;
const FAN_GAP = 1;
const FAN_GAP_PER_EXTRA_WORKER = 0.15;
const NARROW_HOST_DROP = 0.2;
const NARROW_HOST_GAP = 0.15;
const NARROW_HOST_FAN = 0.4;
const NARROW_ROW_GAP = 0.9;
const NARROW_ROW_LABEL_CLEAR = 0.3;
const NARROW_LABEL_CLEAR = 0.25;
const DECISION_GAP = 0.9;
const FULL_WEIGHT = 1;
const THIN_WEIGHT = 0.7;

const WIDE_HOST_DEGREES = { claude: -70, codex: -20 };
const WIDE_FAN_DEGREES = { first: 8, last: 50, step: 10 };
const NARROW_FAN_DEGREES = { spread: 60, step: 16 };
const RING_BOTTOM_DEGREES = 90;
const NARROW_DISPATCH_DROP = 0.3;
const REVIEW_RISE = 0.24;
const DECISION_RISE = 0.16;

const HOSTS: [SceneModel, SceneModel] = [
  { family: 'claude', name: 'Claude Code' },
  { family: 'openai', name: 'Codex' },
];

const HUB_INDEX = 0;
const CLAUDE_INDEX = 1;
const CODEX_INDEX = 2;
const FIRST_WORKER_INDEX = 3;

export function linkPoint(link: SceneLink, t: number): ScenePoint {
  const u = 1 - t;
  return [
    u * u * link.x1 + 2 * u * t * link.cx + t * t * link.x2,
    u * u * link.y1 + 2 * u * t * link.cy + t * t * link.y2,
  ];
}

function labelWidth(text: string, size: number): number {
  return text.length * size * LABEL_GLYPH + size * LABEL_PAD;
}

function portDrop(size: number): number {
  return TILE.half + LABEL_GAP + size * LABEL_BOX_SCALE + PORT_DROP;
}

function tileNode(x: number, y: number, role: SceneRole, model: SceneModel, size: number): SceneNode {
  const width = labelWidth(model.name, size);
  const labelBox: SceneBox = {
    x: x - width / 2,
    y: y + TILE.half + LABEL_GAP,
    width,
    height: size * LABEL_BOX_SCALE,
  };
  return {
    x,
    y,
    r: TILE_RADIUS,
    role,
    family: model.family,
    label: model.name,
    tile: { x: x - TILE.half, y: y - TILE.half, width: TILE.side, height: TILE.side },
    labelBox,
    ports: {
      top: [x, y - TILE.half],
      right: [x + TILE.half, y],
      left: [x - TILE.half, y],
      bottom: [x, labelBox.y + labelBox.height + PORT_DROP],
    },
  };
}

function hubNode(x: number, y: number): SceneNode {
  return {
    x,
    y,
    r: HUB_RADIUS,
    role: 'coordinator',
    tile: { x: x - HUB_RADIUS, y: y - HUB_RADIUS, width: HUB_RADIUS * 2, height: HUB_RADIUS * 2 },
    ports: {
      top: [x, y - HUB_RADIUS],
      right: [x + HUB_RADIUS, y],
      bottom: [x, y + HUB_RADIUS],
      left: [x - HUB_RADIUS, y],
    },
  };
}

function wideRow(spacing: number, widths: number[], ringRight: number, fanGap: number, hubY: number) {
  const first = ringRight + Math.max(TILE.half, widths[0] / 2) + HOST_LEFT_GAP;
  const xs = widths.map((_, index) => first + index * spacing);
  return { xs, rowY: hubY + fanGap + TILE.half };
}

function narrowRow(count: number, spacing: number, centre: number, size: number, hubY: number) {
  const xs = Array.from({ length: count }, (_, index) => centre + (index - (count - 1) / 2) * spacing);
  const ringBottom = hubY + HUB_RADIUS;
  const hostBottom = hubY + NARROW_HOST_DROP + portDrop(size);
  const corner = centre - HUB_RADIUS - NARROW_HOST_GAP;
  const outer = centre - xs[0];
  const cleared =
    outer > centre - corner
      ? ringBottom + ((hostBottom + NARROW_LABEL_CLEAR - ringBottom) * outer) / (centre - corner)
      : 0;
  const rowY = Math.max(ringBottom + NARROW_ROW_GAP, hostBottom + NARROW_ROW_LABEL_CLEAR, cleared) + TILE.half;
  return { xs, rowY };
}

const midpoint = (a: ScenePoint, b: ScenePoint): ScenePoint => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

export function heroScene(pool: ScenePool, direction: SceneDirection): Scene {
  const size = LABEL_SIZE[direction];
  const count = pool.workers.length;
  const widths = pool.workers.map((worker) => labelWidth(worker.name, size));
  const deep = pool.deep[0];
  const nodes: SceneNode[] = [];

  let neighbour = 0;
  for (let i = 1; i < count; i += 1) neighbour = Math.max(neighbour, (widths[i - 1] + widths[i]) / 2);
  const spacing = Math.max(MIN_SPACING[direction], neighbour + LABEL_NEIGHBOUR_GAP);

  let workerXs: number[];
  let rowY: number;

  if (direction === 'wide') {
    const hostY = MARGIN + TILE.half;
    const hubY = Math.max(MARGIN + HUB_RADIUS, hostY + portDrop(size) + HOST_ROW_GAP);
    const ringRight = MARGIN + HUB_RADIUS * 2;
    const fanGap = FAN_GAP + FAN_GAP_PER_EXTRA_WORKER * Math.max(0, count - 4);
    const row = wideRow(spacing, widths, ringRight, fanGap, hubY);
    workerXs = row.xs;
    rowY = row.rowY;
    const claudeX = ringRight + labelWidth(HOSTS[0].name, size) / 2 + HOST_LEFT_GAP;
    const codexX = Math.max(
      claudeX + HOST_MIN_GAP,
      (workerXs[0] + workerXs[count - 1]) / 2 + spacing / 2,
    );
    nodes.push(hubNode(MARGIN + HUB_RADIUS, hubY));
    nodes.push(tileNode(claudeX, hostY, 'host', HOSTS[0], size));
    nodes.push(tileNode(codexX, hostY, 'host', HOSTS[1], size));
  } else {
    const claudeWidth = labelWidth(HOSTS[0].name, size);
    const reach = Math.max(
      HUB_RADIUS + NARROW_HOST_GAP + claudeWidth / 2 + TILE.half + NARROW_HOST_FAN,
      ((count - 1) * spacing) / 2 + widths[0] / 2,
    );
    const centre = MARGIN + reach;
    const hubY = MARGIN + HUB_RADIUS;
    const hostY = hubY + NARROW_HOST_DROP;
    const offset = HUB_RADIUS + NARROW_HOST_GAP + claudeWidth / 2;
    const row = narrowRow(count, spacing, centre, size, hubY);
    workerXs = row.xs;
    rowY = row.rowY;
    nodes.push(hubNode(centre, hubY));
    nodes.push(tileNode(centre - offset, hostY, 'host', HOSTS[0], size));
    nodes.push(tileNode(centre + offset, hostY, 'host', HOSTS[1], size));
  }

  pool.workers.forEach((worker, index) => {
    nodes.push(tileNode(workerXs[index], rowY, 'worker', worker, size));
  });

  const decisionIndex = nodes.length;
  const decisionX = (workerXs[0] + workerXs[count - 1]) / 2;
  const decisionY = rowY + portDrop(size) + DECISION_GAP + TILE.half;
  nodes.push(tileNode(decisionX, decisionY, 'decision', pool.decision, size));
  const deepIndex = nodes.length;
  const deepX = Math.max(workerXs[count - 1], decisionX + spacing);
  nodes.push(tileNode(deepX, decisionY, 'deep', deep, size));

  const links: SceneLink[] = [];
  const wide = direction === 'wide';
  const hub = nodes[HUB_INDEX];
  const claude = nodes[CLAUDE_INDEX];
  const codex = nodes[CODEX_INDEX];

  const ringPoint = (degrees: number): ScenePoint => {
    const angle = (degrees * Math.PI) / 180;
    return [hub.x + HUB_RADIUS * Math.cos(angle), hub.y + HUB_RADIUS * Math.sin(angle)];
  };

  const link = (
    kind: SceneLinkKind,
    from: number,
    start: ScenePoint,
    to: number,
    end: ScenePoint,
    control: ScenePoint,
    weight: number,
    near: boolean,
    hueFamily?: string,
  ) => {
    links.push({
      from,
      to,
      x1: start[0],
      y1: start[1],
      cx: control[0],
      cy: control[1],
      x2: end[0],
      y2: end[1],
      kind,
      weight,
      near,
      hueFamily,
    });
  };

  if (wide) {
    const claudeEnd = ringPoint(WIDE_HOST_DEGREES.claude);
    const codexEnd = ringPoint(WIDE_HOST_DEGREES.codex);
    link('host', CLAUDE_INDEX, claude.ports.left, HUB_INDEX, claudeEnd, [claudeEnd[0], claude.ports.left[1]], FULL_WEIGHT, false, HOSTS[0].family);
    link('host', CODEX_INDEX, codex.ports.bottom, HUB_INDEX, codexEnd, [codex.ports.bottom[0], codexEnd[1]], FULL_WEIGHT, false, HOSTS[1].family);
  } else {
    const claudeControl: ScenePoint = [(claude.ports.right[0] + hub.ports.left[0]) / 2, claude.ports.right[1]];
    const codexControl: ScenePoint = [(codex.ports.left[0] + hub.ports.right[0]) / 2, codex.ports.left[1]];
    link('host', CLAUDE_INDEX, claude.ports.right, HUB_INDEX, hub.ports.left, claudeControl, FULL_WEIGHT, false, HOSTS[0].family);
    link('host', CODEX_INDEX, codex.ports.left, HUB_INDEX, hub.ports.right, codexControl, FULL_WEIGHT, false, HOSTS[1].family);
  }

  const wideStep = Math.min(
    WIDE_FAN_DEGREES.step,
    (WIDE_FAN_DEGREES.last - WIDE_FAN_DEGREES.first) / (count - 1),
  );
  const narrowStep = Math.min(NARROW_FAN_DEGREES.step, NARROW_FAN_DEGREES.spread / (count - 1));

  for (let i = 0; i < count; i += 1) {
    const worker = FIRST_WORKER_INDEX + i;
    const top = nodes[worker].ports.top;
    const bottom = nodes[worker].ports.bottom;
    if (wide) {
      const start = ringPoint(WIDE_FAN_DEGREES.first + (count - 1 - i) * wideStep);
      link('dispatch', HUB_INDEX, start, worker, top, [top[0], start[1]], THIN_WEIGHT, false, nodes[worker].family);
    } else {
      const start = ringPoint(RING_BOTTOM_DEGREES - (i - (count - 1) / 2) * narrowStep);
      const control: ScenePoint = [start[0], start[1] + NARROW_DISPATCH_DROP * (top[1] - start[1])];
      link('dispatch', HUB_INDEX, start, worker, top, control, THIN_WEIGHT, false, nodes[worker].family);
    }
    const decisionTop = nodes[decisionIndex].ports.top;
    const bow = midpoint(bottom, decisionTop);
    link('decision', worker, bottom, decisionIndex, decisionTop, [bow[0], bow[1] - DECISION_RISE], FULL_WEIGHT, false);
    if (i > 0) {
      const start = nodes[worker - 1].ports.right;
      const end = nodes[worker].ports.left;
      const arc = midpoint(start, end);
      link('review', worker - 1, start, worker, end, [arc[0], arc[1] - REVIEW_RISE], FULL_WEIGHT, true);
    }
  }

  const last = FIRST_WORKER_INDEX + count - 1;
  const escalationStart = nodes[last].ports.bottom;
  const escalationEnd = nodes[deepIndex].ports.top;
  link('escalation', last, escalationStart, deepIndex, escalationEnd, midpoint(escalationStart, escalationEnd), FULL_WEIGHT, true, deep.family);

  let width = 0;
  let height = 0;
  for (const node of nodes) {
    const boxes = node.labelBox ? [node.tile, node.labelBox] : [node.tile];
    for (const box of boxes) {
      width = Math.max(width, box.x + box.width);
      height = Math.max(height, box.y + box.height);
    }
    height = Math.max(height, node.ports.bottom[1]);
  }

  return { direction, width: width + MARGIN, height: height + MARGIN, labelSize: size, nodes, links };
}
