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

export const TILE = { side: 0.72, half: 0.36, radius: 0.18 };
export const LABEL = { size: 0.15, gap: 0.42 };
export const HERO_FOCUS = { x: 13, y: 4.5 };

const SPACING = 1.4;
const TOP_Y = 3.1;
const BOTTOM_Y = 6;
const HOST_Y = 1.55;
const HUB = { x: 7.5, y: 2.6 };
const CODEX_X = 11;
const CLAUDE_X = 13;
const DEEP_OFFSET = 2;
const HUB_RADIUS = 0.9;
const TILE_RADIUS = 0.42;
const LABEL_DROP = 0.99;
const FULL_WEIGHT = 1;
const THIN_WEIGHT = 0.7;

function rowX(count: number, centre: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [centre];
  if (count === 2) return [centre - SPACING / 2, centre + SPACING / 2];
  return [centre - SPACING, centre, centre + SPACING];
}

function below(node: SceneNode): [number, number] {
  return [node.x, node.y + LABEL_DROP];
}

function sideEntry(node: SceneNode, toward: number): [number, number] {
  const side = toward >= node.x ? TILE.half : -TILE.half;
  return [node.x + side, node.y];
}

export function heroScene(pool: ScenePool): Scene {
  const decisionX = HERO_FOCUS.x;
  const decisionY = HERO_FOCUS.y;
  const topCount = Math.min(pool.workers.length, 3);
  const top = pool.workers.slice(0, topCount);
  const bottom = pool.workers.slice(topCount);
  const topX = rowX(top.length, decisionX);
  const bottomX = rowX(bottom.length, decisionX);

  const nodes: SceneNode[] = [
    { x: HUB.x, y: HUB.y, r: HUB_RADIUS, role: 'coordinator' },
    { x: CODEX_X, y: HOST_Y, r: TILE_RADIUS, role: 'host', family: 'openai', label: 'Codex' },
    { x: CLAUDE_X, y: HOST_Y, r: TILE_RADIUS, role: 'host', family: 'claude', label: 'Claude Code' },
  ];

  top.forEach((model, index) => {
    nodes.push({ x: topX[index], y: TOP_Y, r: TILE_RADIUS, role: 'worker', family: model.family, label: model.name });
  });
  bottom.forEach((model, index) => {
    nodes.push({ x: bottomX[index], y: BOTTOM_Y, r: TILE_RADIUS, role: 'worker', family: model.family, label: model.name });
  });

  const decisionIndex = nodes.length;
  nodes.push({ x: decisionX, y: decisionY, r: TILE_RADIUS, role: 'decision', family: pool.decision.family, label: pool.decision.name });
  const deepIndex = nodes.length;
  const deep = pool.deep[0];
  nodes.push({ x: decisionX + DEEP_OFFSET, y: decisionY, r: TILE_RADIUS, role: 'deep', family: deep.family, label: deep.name });

  const links: SceneLink[] = [];
  const push = (link: SceneLink) => links.push(link);
  const hub = nodes[0];
  const decision = nodes[decisionIndex];

  links.push({ from: 1, to: 0, x1: below(nodes[1])[0], y1: below(nodes[1])[1], x2: hub.x, y2: hub.y, kind: 'coordinator', phase: 0, weight: FULL_WEIGHT, near: false, hueFamily: 'openai' });
  links.push({ from: 2, to: 0, x1: below(nodes[2])[0], y1: below(nodes[2])[1], x2: hub.x, y2: hub.y, kind: 'coordinator', phase: 0.5, weight: FULL_WEIGHT, near: false, hueFamily: 'claude' });

  const workerIndex = (index: number) => 3 + index;

  nodes.forEach((node, index) => {
    if (node.role !== 'worker') return;
    const fromTop = index < 3 + topCount;
    if (fromTop) {
      const [x1, y1] = below(node);
      push({ from: index, to: decisionIndex, x1, y1, x2: decision.x, y2: decision.y, kind: 'decision', phase: 0.12 + index * 0.11, weight: FULL_WEIGHT, near: false });
    } else {
      const [x1, y1] = sideEntry(node, decision.x);
      const [x2, y2] = sideEntry(decision, node.x);
      push({ from: index, to: decisionIndex, x1, y1, x2, y2, kind: 'decision', phase: 0.12 + index * 0.11, weight: FULL_WEIGHT, near: false });
    }
  });

  for (let i = 1; i < top.length; i += 1) {
    const a = workerIndex(i - 1);
    const b = workerIndex(i);
    push({ from: a, to: b, x1: nodes[a].x, y1: nodes[a].y, x2: nodes[b].x, y2: nodes[b].y, kind: 'review', phase: 0.2 + i * 0.13, weight: FULL_WEIGHT, near: true });
  }
  for (let i = 1; i < bottom.length; i += 1) {
    const a = workerIndex(topCount + i - 1);
    const b = workerIndex(topCount + i);
    push({ from: a, to: b, x1: nodes[a].x, y1: nodes[a].y, x2: nodes[b].x, y2: nodes[b].y, kind: 'review', phase: 0.34 + i * 0.17, weight: FULL_WEIGHT, near: true });
  }
  if (bottom.length === 1) {
    const a = workerIndex(0);
    const b = workerIndex(topCount);
    push({ from: a, to: b, x1: below(nodes[a])[0], y1: below(nodes[a])[1], x2: nodes[b].x, y2: nodes[b].y, kind: 'review', phase: 0.44, weight: FULL_WEIGHT, near: true });
  }

  const escalator = workerIndex(topCount - 1);
  push({ from: escalator, to: deepIndex, x1: below(nodes[escalator])[0], y1: below(nodes[escalator])[1], x2: nodes[deepIndex].x, y2: nodes[deepIndex].y, kind: 'worker', phase: 0.3, weight: FULL_WEIGHT, near: true, hueFamily: deep.family });

  const firstTop = workerIndex(0);
  push({ from: 0, to: firstTop, x1: hub.x, y1: hub.y, x2: nodes[firstTop].x, y2: nodes[firstTop].y, kind: 'coordinator', phase: 0.08, weight: THIN_WEIGHT, near: false, hueFamily: nodes[firstTop].family });
  push({ from: firstTop, to: 0, x1: nodes[firstTop].x, y1: nodes[firstTop].y, x2: hub.x, y2: hub.y, kind: 'review', phase: 0.58, weight: THIN_WEIGHT, near: true });

  if (bottom.length > 0) {
    const firstBottom = workerIndex(topCount);
    push({ from: 0, to: firstBottom, x1: hub.x, y1: hub.y, x2: nodes[firstBottom].x, y2: nodes[firstBottom].y, kind: 'coordinator', phase: 0.62, weight: THIN_WEIGHT, near: false, hueFamily: nodes[firstBottom].family });
    push({ from: firstBottom, to: 0, x1: nodes[firstBottom].x, y1: nodes[firstBottom].y, x2: hub.x, y2: hub.y, kind: 'review', phase: 0.86, weight: THIN_WEIGHT, near: true });
  }

  return { nodes, links };
}
