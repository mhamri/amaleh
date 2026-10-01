export type SceneModel = { family: string; name: string };

export type SceneRole = 'coordinator' | 'host' | 'worker' | 'decision' | 'deep';

export type SceneNode = {
  x: number;
  y: number;
  r: number;
  role: SceneRole;
  family?: string;
  label?: string;
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
};

export type Scene = { nodes: SceneNode[]; links: SceneLink[] };

export type ScenePool = { workers: SceneModel[]; deep: SceneModel[]; decision: SceneModel };

type SceneSide = 'top' | 'right' | 'bottom' | 'left';

export const TILE = { side: 0.72, half: 0.36, radius: 0.18 };
export const LABEL = { size: 0.15, gap: 0.42 };
export const HERO_FOCUS = { x: 13.2, y: 4.18 };

const SPACING = 1.8;
const CLAUDE_Y = 0.7;
const CODEX_Y = 1.6;
const TOP_Y = 2.9;
const DECISION_Y = 5.05;
const BOTTOM_Y = 7.2;
const CLAUDE_X = 11.3;
const CODEX_X = 15.3;
const DECISION_X = 13;
const HUB = { x: 7.5, y: 2.4 };
const DEEP_OFFSET = 2;
const HUB_RADIUS = 0.9;
const TILE_RADIUS = 0.42;
const LABEL_DROP = 0.93;
const FULL_WEIGHT = 1;
const THIN_WEIGHT = 0.7;
const DIAGONAL_BAND = 1.1;

type Segment = { x1: number; y1: number; x2: number; y2: number };

function rowX(count: number, centre: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [centre];
  if (count === 2) return [centre - SPACING / 2, centre + SPACING / 2];
  return [centre - SPACING, centre, centre + SPACING];
}

function port(node: SceneNode, side: SceneSide): [number, number] {
  if (!node.family) {
    if (side === 'top') return [node.x, node.y - node.r];
    if (side === 'right') return [node.x + node.r, node.y];
    if (side === 'left') return [node.x - node.r, node.y];
    return [node.x, node.y + node.r];
  }
  if (side === 'top') return [node.x, node.y - TILE.half];
  if (side === 'right') return [node.x + TILE.half, node.y];
  if (side === 'left') return [node.x - TILE.half, node.y];
  return [node.x, node.y + LABEL_DROP];
}

function facingSides(node: SceneNode, other: SceneNode): [SceneSide, SceneSide] {
  const upDown: SceneSide = other.y > node.y ? 'bottom' : 'top';
  const across: SceneSide = other.x >= node.x ? 'right' : 'left';
  return Math.abs(other.y - node.y) >= Math.abs(other.x - node.x) ? [upDown, across] : [across, upDown];
}

function arrivesAt(node: SceneNode, side: SceneSide, [x, y]: [number, number]): boolean {
  const [portX, portY] = port(node, side);
  const across = Math.abs(x - node.x);
  const upDown = Math.abs(y - node.y);
  if (side === 'right') return x > portX && across * DIAGONAL_BAND >= upDown;
  if (side === 'left') return x < portX && across * DIAGONAL_BAND >= upDown;
  if (side === 'bottom') return y > portY && upDown * DIAGONAL_BAND >= across;
  return y < portY && upDown * DIAGONAL_BAND >= across;
}

function join(a: SceneNode, b: SceneNode): Segment {
  const [a0, a1] = facingSides(a, b);
  const [b0, b1] = facingSides(b, a);
  const pairs: [SceneSide, SceneSide][] = [[a0, b0], [a1, b0], [a0, b1], [a1, b1]];
  for (const [sideA, sideB] of pairs) {
    const [x1, y1] = port(a, sideA);
    const [x2, y2] = port(b, sideB);
    if (arrivesAt(a, sideA, [x2, y2]) && arrivesAt(b, sideB, [x1, y1])) return { x1, y1, x2, y2 };
  }
  throw new Error(`heroScene cannot join ${a.label ?? a.role} to ${b.label ?? b.role} at ports facing each other`);
}

function reversed({ x1, y1, x2, y2 }: Segment): Segment {
  return { x1: x2, y1: y2, x2: x1, y2: y1 };
}

export function heroScene(pool: ScenePool): Scene {
  const topCount = Math.min(pool.workers.length, 3);
  const top = pool.workers.slice(0, topCount);
  const bottom = pool.workers.slice(topCount);
  const topX = rowX(top.length, DECISION_X);
  const bottomX = rowX(bottom.length, DECISION_X);

  const nodes: SceneNode[] = [
    { x: HUB.x, y: HUB.y, r: HUB_RADIUS, role: 'coordinator' },
    { x: CLAUDE_X, y: CLAUDE_Y, r: TILE_RADIUS, role: 'host', family: 'claude', label: 'Claude Code' },
    { x: CODEX_X, y: CODEX_Y, r: TILE_RADIUS, role: 'host', family: 'openai', label: 'Codex' },
  ];

  top.forEach((model, index) => {
    nodes.push({ x: topX[index], y: TOP_Y, r: TILE_RADIUS, role: 'worker', family: model.family, label: model.name });
  });
  bottom.forEach((model, index) => {
    nodes.push({ x: bottomX[index], y: BOTTOM_Y, r: TILE_RADIUS, role: 'worker', family: model.family, label: model.name });
  });

  const decisionIndex = nodes.length;
  nodes.push({ x: DECISION_X, y: DECISION_Y, r: TILE_RADIUS, role: 'decision', family: pool.decision.family, label: pool.decision.name });
  const deepIndex = nodes.length;
  const deep = pool.deep[0];
  nodes.push({ x: DECISION_X + DEEP_OFFSET, y: DECISION_Y, r: TILE_RADIUS, role: 'deep', family: deep.family, label: deep.name });

  const links: SceneLink[] = [];
  const hub = nodes[0];
  const decision = nodes[decisionIndex];
  const workerIndex = (index: number) => 3 + index;

  links.push({ from: 1, to: 0, ...join(nodes[1], hub), kind: 'coordinator', phase: 0, weight: FULL_WEIGHT, near: false, hueFamily: 'claude' });
  links.push({ from: 2, to: 0, ...join(nodes[2], hub), kind: 'coordinator', phase: 0.5, weight: FULL_WEIGHT, near: false, hueFamily: 'openai' });

  nodes.forEach((node, index) => {
    if (node.role !== 'worker') return;
    links.push({ from: index, to: decisionIndex, ...join(node, decision), kind: 'decision', phase: 0.12 + index * 0.11, weight: FULL_WEIGHT, near: false });
  });

  for (let i = 1; i < top.length; i += 1) {
    const a = workerIndex(i - 1);
    const b = workerIndex(i);
    links.push({ from: a, to: b, ...join(nodes[a], nodes[b]), kind: 'review', phase: 0.2 + i * 0.13, weight: FULL_WEIGHT, near: true });
  }
  for (let i = 1; i < bottom.length; i += 1) {
    const a = workerIndex(topCount + i - 1);
    const b = workerIndex(topCount + i);
    links.push({ from: a, to: b, ...join(nodes[a], nodes[b]), kind: 'review', phase: 0.34 + i * 0.17, weight: FULL_WEIGHT, near: true });
  }
  if (bottom.length === 1) {
    const a = workerIndex(0);
    const b = workerIndex(topCount);
    links.push({ from: a, to: b, ...join(nodes[a], nodes[b]), kind: 'review', phase: 0.44, weight: FULL_WEIGHT, near: true });
  }

  const escalator = workerIndex(topCount - 1);
  links.push({ from: escalator, to: deepIndex, ...join(nodes[escalator], nodes[deepIndex]), kind: 'worker', phase: 0.3, weight: FULL_WEIGHT, near: true, hueFamily: deep.family });

  const firstTop = workerIndex(0);
  const hubToFirstTop = join(hub, nodes[firstTop]);
  links.push({ from: 0, to: firstTop, ...hubToFirstTop, kind: 'coordinator', phase: 0.08, weight: THIN_WEIGHT, near: false, hueFamily: nodes[firstTop].family });
  links.push({ from: firstTop, to: 0, ...reversed(hubToFirstTop), kind: 'review', phase: 0.58, weight: THIN_WEIGHT, near: true });

  if (bottom.length > 0) {
    const firstBottom = workerIndex(topCount);
    const hubToFirstBottom = join(hub, nodes[firstBottom]);
    links.push({ from: 0, to: firstBottom, ...hubToFirstBottom, kind: 'coordinator', phase: 0.62, weight: THIN_WEIGHT, near: false, hueFamily: nodes[firstBottom].family });
    links.push({ from: firstBottom, to: 0, ...reversed(hubToFirstBottom), kind: 'review', phase: 0.86, weight: THIN_WEIGHT, near: true });
  }

  return { nodes, links };
}
