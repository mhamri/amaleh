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

export type SceneLinkKind = 'coordinator' | 'worker' | 'review' | 'decision';

export type SceneLink = {
  from: number;
  to: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: SceneLinkKind;
  phase: number;
  weight: number;
  near: boolean;
  hueFamily?: string;
  returnPhase?: number;
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

const HOSTS: [SceneModel, SceneModel] = [
  { family: 'claude', name: 'Claude Code' },
  { family: 'openai', name: 'Codex' },
];

const HUB_INDEX = 0;
const CLAUDE_INDEX = 1;
const CODEX_INDEX = 2;
const FIRST_WORKER_INDEX = 3;

const CLAUDE_PHASE = 0;
const CODEX_PHASE = 0.5;
const ESCALATION_PHASE = 0.3;
const DECISION_PHASE = 0.12;
const DECISION_PHASE_STEP = 0.11;
const REVIEW_PHASE = 0.2;
const REVIEW_PHASE_STEP = 0.13;
const DISPATCH_PHASE = 0.08;
const DISPATCH_PHASE_STEP = 0.07;
const RETURN_PHASE = 0.6;
const RETURN_PHASE_STEP = 0.06;

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
  const hubOut: SceneSide = wide ? 'right' : 'bottom';
  const claudeSide: SceneSide = wide ? 'bottom' : 'right';
  const codexSide: SceneSide = wide ? 'bottom' : 'left';
  const ringSide: SceneSide = wide ? 'right' : 'left';

  const link = (
    from: number,
    fromSide: SceneSide,
    to: number,
    toSide: SceneSide,
    kind: SceneLinkKind,
    phase: number,
    weight: number,
    near: boolean,
    hueFamily?: string,
    returnPhase?: number,
  ) => {
    const [x1, y1] = nodes[from].ports[fromSide];
    const [x2, y2] = nodes[to].ports[toSide];
    links.push({ from, to, x1, y1, x2, y2, kind, phase, weight, near, hueFamily, returnPhase });
  };

  link(CLAUDE_INDEX, claudeSide, HUB_INDEX, ringSide, 'coordinator', CLAUDE_PHASE, FULL_WEIGHT, false, HOSTS[0].family);
  link(CODEX_INDEX, codexSide, HUB_INDEX, 'right', 'coordinator', CODEX_PHASE, FULL_WEIGHT, false, HOSTS[1].family);

  for (let i = 0; i < count; i += 1) {
    const worker = FIRST_WORKER_INDEX + i;
    link(
      HUB_INDEX,
      hubOut,
      worker,
      'top',
      'coordinator',
      DISPATCH_PHASE + i * DISPATCH_PHASE_STEP,
      THIN_WEIGHT,
      false,
      nodes[worker].family,
      RETURN_PHASE + i * RETURN_PHASE_STEP,
    );
    link(worker, 'bottom', decisionIndex, 'top', 'decision', DECISION_PHASE + i * DECISION_PHASE_STEP, FULL_WEIGHT, false);
    if (i > 0) link(worker - 1, 'right', worker, 'left', 'review', REVIEW_PHASE + i * REVIEW_PHASE_STEP, FULL_WEIGHT, true);
  }

  link(
    FIRST_WORKER_INDEX + count - 1,
    'bottom',
    deepIndex,
    'top',
    'worker',
    ESCALATION_PHASE,
    FULL_WEIGHT,
    true,
    deep.family,
  );

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
