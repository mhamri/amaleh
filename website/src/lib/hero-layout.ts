import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode, ElkPort } from 'elkjs/lib/elk-api.js';

export type HeroDirection = 'wide' | 'narrow';
export type HeroRole = 'coordinator' | 'host' | 'worker' | 'decision' | 'deep';
export type HeroSide = 'top' | 'right' | 'bottom' | 'left';
export type HeroPoint = { x: number; y: number };
export type HeroBox = { x: number; y: number; width: number; height: number };
export type HeroNode = {
  id: string;
  role: HeroRole;
  family?: string;
  label?: string;
  tile: HeroBox;
  labelBox?: HeroBox;
  ports: Record<HeroSide, HeroPoint>;
};
export type HeroLinkKind = 'host' | 'dispatch' | 'decision' | 'review' | 'escalation';
export type HeroLink = { id: string; kind: HeroLinkKind; from: string; to: string; points: HeroPoint[] };
export type HeroModel = { family: string; name: string };
export type HeroPool = { workers: HeroModel[]; deep: HeroModel; decision: HeroModel };
export type HeroScene = {
  direction: HeroDirection;
  width: number;
  height: number;
  labelSize: number;
  nodes: HeroNode[];
  links: HeroLink[];
};

type Spec = { id: string; role: HeroRole; family?: string; label?: string };

type Flow = { id: string; kind: HeroLinkKind; from: string; to: string };

const TILE = 36;
const HUB_TILE = 30;
const LABEL_SIZE = 10;
const LABEL_GAP = 5;
const LABEL_HEIGHT = 12;
const PADDING = 10;

const HUB_ID = 'hub';
const DECISION_ID = 'decision';
const DEEP_ID = 'deep';

const SIDES: HeroSide[] = ['top', 'right', 'bottom', 'left'];

const PORT_SIDE: Record<HeroSide, string> = {
  top: 'NORTH',
  right: 'EAST',
  bottom: 'SOUTH',
  left: 'WEST',
};

const ROOT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.spacing.nodeNode': '22',
  'elk.layered.spacing.nodeNodeBetweenLayers': '44',
  'elk.spacing.edgeNode': '12',
  'elk.spacing.edgeEdge': '8',
  'elk.layered.spacing.edgeNodeBetweenLayers': '14',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '8',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.separateConnectedComponents': 'false',
  'elk.padding': `[top=${PADDING},left=${PADDING},bottom=${PADDING},right=${PADDING}]`,
  'elk.randomSeed': '1',
};

const LABEL_DEFAULT_ADVANCE = 0.6;
const HALF_EM = 0.5;
const LABEL_PADDING = 0.16;
const LABEL_ADVANCE: Record<string, number> = {
  ' ': 0.28,
  A: 0.7, B: 0.68, C: 0.72, D: 0.75, E: 0.67, F: 0.62, G: 0.8, H: 0.75, I: 0.3, J: 0.4, K: 0.7, L: 0.58,
  M: 0.95, N: 0.75, O: 0.8, P: 0.67, Q: 0.8, R: 0.72, S: 0.67, T: 0.62, U: 0.75, V: 0.68, W: 1, X: 0.68, Y: 0.67,
  Z: 0.62,
  a: 0.56, b: 0.57, c: 0.5, d: 0.57, e: 0.57, f: 0.3, g: 0.57, h: 0.57, i: 0.24, j: 0.24, k: 0.52, l: 0.24,
  m: 0.86, n: 0.57, o: 0.57, p: 0.57, q: 0.57, r: 0.36, s: 0.5, t: 0.3, u: 0.57, v: 0.52, w: 0.76, x: 0.52, y: 0.52,
  z: 0.48,
};

function labelAdvance(character: string): number {
  return LABEL_ADVANCE[character] ?? LABEL_DEFAULT_ADVANCE;
}

function labelWidth(label: string): number {
  const characters = [...label];
  const ems = LABEL_PADDING + characters.reduce((total, character) => total + labelAdvance(character), 0);
  return Math.max(Math.ceil(ems * LABEL_SIZE), Math.ceil(characters.length * LABEL_SIZE * HALF_EM));
}

function tileWidth(spec: Spec): number {
  return spec.role === 'coordinator' ? HUB_TILE : TILE;
}

function boxWidthOf(spec: Spec, width: number): number {
  return spec.role === 'coordinator' ? HUB_TILE : width;
}

function nodeHeight(spec: Spec): number {
  return spec.role === 'coordinator' ? HUB_TILE : TILE + LABEL_GAP + LABEL_HEIGHT;
}

function offset(spec: Spec, width: number): number {
  return (boxWidthOf(spec, width) - tileWidth(spec)) / 2;
}

function specs(pool: HeroPool): Spec[] {
  return [
    { id: 'claude-code', role: 'host', family: 'claude', label: 'Claude Code' },
    { id: 'codex', role: 'host', family: 'openai', label: 'Codex' },
    { id: HUB_ID, role: 'coordinator' },
    ...pool.workers.map((worker, index) => ({
      id: `worker-${index + 1}`,
      role: 'worker' as HeroRole,
      family: worker.family,
      label: worker.name,
    })),
    { id: DECISION_ID, role: 'decision', family: pool.decision.family, label: pool.decision.name },
    { id: DEEP_ID, role: 'deep', family: pool.deep.family, label: pool.deep.name },
  ];
}

function even(value: number): number {
  return 2 * Math.ceil(value / 2);
}

function ownBoxWidth(spec: Spec): number {
  return even(Math.max(TILE, spec.label ? labelWidth(spec.label) : TILE));
}

function boxWidth(list: Spec[]): number {
  let width = TILE;
  for (const spec of list) {
    if (spec.role === 'worker') width = Math.max(width, ownBoxWidth(spec));
  }
  return width;
}

function widthOf(spec: Spec, width: number): number {
  return spec.role === 'worker' ? width : ownBoxWidth(spec);
}

function portId(nodeId: string, side: HeroSide): string {
  return `${nodeId}__${side}`;
}

function elkPorts(spec: Spec, width: number): ElkPort[] {
  const box = { width: boxWidthOf(spec, width), height: nodeHeight(spec) };
  return SIDES.map((side) => ({
    id: portId(spec.id, side),
    width: 0,
    height: 0,
    x: side === 'left' ? 0 : side === 'right' ? box.width : box.width / 2,
    y: side === 'top' ? 0 : side === 'bottom' ? box.height : tileWidth(spec) / 2,
    layoutOptions: { 'elk.port.side': PORT_SIDE[side] },
  }));
}

function elkChild(spec: Spec, width: number): ElkNode {
  const layoutOptions: Record<string, string> = { 'elk.portConstraints': 'FIXED_POS' };
  if (spec.role === 'host') layoutOptions['elk.layered.layering.layerConstraint'] = 'FIRST';
  if (spec.role === 'decision' || spec.role === 'deep') {
    layoutOptions['elk.layered.layering.layerConstraint'] = 'LAST';
  }
  return {
    id: spec.id,
    width: boxWidthOf(spec, width),
    height: nodeHeight(spec),
    layoutOptions,
    ports: elkPorts(spec, width),
  };
}

function flows(workers: string[]): Flow[] {
  const out: Flow[] = [
    { id: 'host-claude-code-hub', kind: 'host', from: 'claude-code', to: HUB_ID },
    { id: 'host-codex-hub', kind: 'host', from: 'codex', to: HUB_ID },
  ];
  workers.forEach((id, index) => {
    out.push({ id: `dispatch-hub-${id}`, kind: 'dispatch', from: HUB_ID, to: id });
    out.push({ id: `decision-${id}-${DECISION_ID}`, kind: 'decision', from: id, to: DECISION_ID });
    if (index === workers.length - 1) out.push({ id: `escalation-${id}-${DEEP_ID}`, kind: 'escalation', from: id, to: DEEP_ID });
  });
  return out;
}

function heroNode(spec: Spec, x: number, y: number, width: number): HeroNode {
  const box = { width: boxWidthOf(spec, width), height: nodeHeight(spec) };
  const left = x + offset(spec, width);
  const side = tileWidth(spec);
  const tile: HeroBox = { x: left, y, width: side, height: side };
  const middle = left + side / 2;
  const node: HeroNode = {
    id: spec.id,
    role: spec.role,
    tile,
    ports: {
      top: { x: middle, y },
      right: { x: left + side, y: y + side / 2 },
      bottom: { x: middle, y: y + box.height },
      left: { x: left, y: y + side / 2 },
    },
  };
  if (spec.family) node.family = spec.family;
  if (spec.label) {
    node.label = spec.label;
    const text = labelWidth(spec.label);
    node.labelBox = { x: middle - text / 2, y: y + side + LABEL_GAP, width: text, height: LABEL_HEIGHT };
  }
  return node;
}

function shift(point: HeroPoint, node: HeroNode, side: HeroSide): HeroPoint {
  if (side === 'right' || side === 'left') return { x: node.ports[side].x, y: point.y };
  return { x: point.x, y: node.ports[side].y };
}

export async function layoutHero(pool: HeroPool, direction: HeroDirection): Promise<HeroScene> {
  const list = specs(pool);
  const width = boxWidth(list);

  const workers = list.filter((spec) => spec.role === 'worker').map((spec) => spec.id);
  const out: HeroSide = direction === 'wide' ? 'right' : 'bottom';
  const into: HeroSide = direction === 'wide' ? 'left' : 'top';
  const paths = flows(workers);

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      ...ROOT_OPTIONS,
      'elk.direction': direction === 'wide' ? 'RIGHT' : 'DOWN',
    },
    children: list.map((spec) => elkChild(spec, widthOf(spec, width))),
    edges: paths.map((flow) => ({
      id: flow.id,
      sources: [portId(flow.from, out)],
      targets: [portId(flow.to, into)],
    })),
  };

  const elk = new ELK();
  const laid = (await elk.layout(graph)) as ElkNode;
  const drawn = new Map(((laid.children ?? []) as ElkNode[]).map((child) => [child.id, child]));
  const nodes = list.map((spec) => heroNode(spec, drawn.get(spec.id)?.x ?? 0, drawn.get(spec.id)?.y ?? 0, widthOf(spec, width)));
  const index = new Map(nodes.map((node) => [node.id, node]));

  const links: HeroLink[] = [];
  for (const flow of paths) {
    const section = ((laid.edges ?? []) as ElkExtendedEdge[])
      .find((edge) => edge.id === flow.id)?.sections?.[0];
    if (!section) throw new Error(`layoutHero lost the ${flow.kind} link ${flow.id}`);
    links.push({
      id: flow.id,
      kind: flow.kind,
      from: flow.from,
      to: flow.to,
      points: [
        shift(section.startPoint, index.get(flow.from) as HeroNode, out),
        ...(section.bendPoints ?? []),
        shift(section.endPoint, index.get(flow.to) as HeroNode, into),
      ],
    });
  }

  const review: HeroSide = direction === 'wide' ? 'bottom' : 'right';
  const facing: HeroSide = direction === 'wide' ? 'top' : 'left';
  const tiles = nodes.filter((node) => node.role === 'worker');
  for (let at = 1; at < tiles.length; at += 1) {
    const lead = tiles[at - 1] as HeroNode;
    const next = tiles[at] as HeroNode;
    links.push({
      id: `review-${lead.id}-${next.id}`,
      kind: 'review',
      from: lead.id,
      to: next.id,
      points: [lead.ports[review], next.ports[facing]],
    });
  }

  return {
    direction,
    width: laid.width ?? 0,
    height: laid.height ?? 0,
    labelSize: LABEL_SIZE,
    nodes,
    links,
  };
}
