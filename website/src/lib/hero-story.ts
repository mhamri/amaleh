import type { Scene, SceneLinkKind } from './hero-scene';

export type StoryBeat =
  | { kind: 'travel'; start: number; end: number; link: number; direction: 1 | -1 }
  | { kind: 'glow'; start: number; end: number; node: number }
  | { kind: 'work'; start: number; end: number; node: number }
  | { kind: 'verdict'; start: number; node: number; passed: boolean }
  | { kind: 'accept'; start: number; segment: number }
  | { kind: 'pulse'; start: number };

export type Story = { length: number; beats: StoryBeat[] };

export type SceneFrame = {
  linkLevel: Float32Array;
  linkHead: Float32Array;
  linkDirection: Float32Array;
  nodeLevel: Float32Array;
  nodeWork: Float32Array;
  nodeVerdict: Float32Array;
  nodeFailed: Float32Array;
  segments: Float32Array;
  pulse: number;
};

export const NO_HEAD = -1;
export const NO_WORK = -1;

const HOST_TRAVEL = 0.9;
const DISPATCH_TRAVEL = 1.1;
const BUILD = 1.5;
const QUESTION_DELAY = 0.3;
const QUESTION_TRAVEL = 0.4;
const QUESTION_THINK = 0.25;
const REVIEW_HOP = 0.6;
const REVIEW = 0.7;
const ESCALATION_TRAVEL = 0.6;
const REPAIR = 1.2;
const RETURN_TRAVEL = 1.1;
const SETTLE = 0.6;
const REST = 0.8;

const LINK_LEAD = 0.2;
const LINK_FADE = 0.5;
const NODE_FADE = 0.25;
const VERDICT_FADE = 0.8;
const PULSE_FADE = 0.7;
const SEGMENT_FILL = 0.4;
const WORK_TURNS_PER_SECOND = 1.1;

export const STILL_SECONDS = HOST_TRAVEL + DISPATCH_TRAVEL / 2;

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

export function heroStory(scene: Scene): Story {
  const indexOf = (role: string) =>
    scene.nodes.flatMap((node, index) => (node.role === role ? [index] : []));
  const hub = indexOf('coordinator')[0];
  const hosts = indexOf('host');
  const workers = indexOf('worker');
  const decision = indexOf('decision')[0];
  const deep = indexOf('deep')[0];

  const linkOf = (kind: SceneLinkKind, a: number, b: number) => {
    const index = scene.links.findIndex(
      (link) => link.kind === kind && ((link.from === a && link.to === b) || (link.from === b && link.to === a)),
    );
    if (index < 0) {
      throw new Error(
        `website/src/lib/hero-story.ts needs a ${kind} link between scene nodes ${a} and ${b}, and heroScene in website/src/lib/hero-scene.ts returned none.`,
      );
    }
    return index;
  };

  const beats: StoryBeat[] = [];
  const travel = (kind: SceneLinkKind, from: number, to: number, start: number, duration: number) => {
    const link = linkOf(kind, from, to);
    beats.push({ kind: 'travel', start, end: start + duration, link, direction: scene.links[link].from === from ? 1 : -1 });
    return start + duration;
  };

  const count = workers.length;
  const lastWorker = workers[count - 1];
  let at = 0;

  for (let turn = 0; turn < count; turn += 1) {
    const host = hosts[turn % hosts.length];
    const builder = workers[turn];
    const reviewer = turn < count - 1 ? workers[turn + 1] : workers[turn - 1];
    const escalates = reviewer === lastWorker;

    beats.push({ kind: 'glow', start: at, end: at + HOST_TRAVEL, node: host });
    at = travel('host', host, hub, at, HOST_TRAVEL);
    beats.push({ kind: 'pulse', start: at });
    at = travel('dispatch', hub, builder, at, DISPATCH_TRAVEL);

    beats.push({ kind: 'work', start: at, end: at + BUILD, node: builder });
    const asked = travel('decision', builder, decision, at + QUESTION_DELAY, QUESTION_TRAVEL);
    beats.push({ kind: 'work', start: asked, end: asked + QUESTION_THINK, node: decision });
    travel('decision', decision, builder, asked + QUESTION_THINK, QUESTION_TRAVEL);
    at += BUILD;

    at = travel('review', builder, reviewer, at, REVIEW_HOP);
    beats.push({ kind: 'work', start: at, end: at + REVIEW, node: reviewer });
    at += REVIEW;

    if (escalates) {
      beats.push({ kind: 'verdict', start: at, node: reviewer, passed: false });
      at = travel('escalation', reviewer, deep, at, ESCALATION_TRAVEL);
      beats.push({ kind: 'work', start: at, end: at + REPAIR, node: deep });
      at += REPAIR;
      at = travel('escalation', deep, reviewer, at, ESCALATION_TRAVEL);
    }

    beats.push({ kind: 'verdict', start: at, node: reviewer, passed: true });
    at = travel('dispatch', reviewer, hub, at, RETURN_TRAVEL);
    beats.push({ kind: 'accept', start: at, segment: turn });
    beats.push({ kind: 'pulse', start: at });
    at += SETTLE;
  }

  return { length: at + REST, beats };
}

export function emptyFrame(scene: Scene): SceneFrame {
  const links = scene.links.length;
  const nodes = scene.nodes.length;
  const workers = scene.nodes.filter((node) => node.role === 'worker').length;
  return {
    linkLevel: new Float32Array(links),
    linkHead: new Float32Array(links),
    linkDirection: new Float32Array(links),
    nodeLevel: new Float32Array(nodes),
    nodeWork: new Float32Array(nodes),
    nodeVerdict: new Float32Array(nodes),
    nodeFailed: new Float32Array(nodes),
    segments: new Float32Array(workers),
    pulse: 0,
  };
}

const envelope = (at: number, start: number, end: number, lead: number, fade: number) => {
  if (at < start) return Math.max(0, 1 - (start - at) / lead);
  if (at > end) return Math.max(0, 1 - (at - end) / fade);
  return 1;
};

export function fillFrame(story: Story, seconds: number, frame: SceneFrame): SceneFrame {
  const at = ((seconds % story.length) + story.length) % story.length;
  frame.linkLevel.fill(0);
  frame.linkHead.fill(NO_HEAD);
  frame.linkDirection.fill(1);
  frame.nodeLevel.fill(0);
  frame.nodeWork.fill(NO_WORK);
  frame.nodeVerdict.fill(0);
  frame.nodeFailed.fill(0);
  frame.segments.fill(0);
  frame.pulse = 0;

  const closing = 1 - smooth((at - (story.length - REST)) / REST);

  for (const beat of story.beats) {
    if (beat.kind === 'travel') {
      const level = envelope(at, beat.start, beat.end, LINK_LEAD, LINK_FADE);
      if (level > frame.linkLevel[beat.link]) frame.linkLevel[beat.link] = level;
      if (at >= beat.start && at <= beat.end) {
        const eased = smooth((at - beat.start) / (beat.end - beat.start));
        frame.linkHead[beat.link] = beat.direction === 1 ? eased : 1 - eased;
        frame.linkDirection[beat.link] = beat.direction;
      }
    } else if (beat.kind === 'glow' || beat.kind === 'work') {
      const level = envelope(at, beat.start, beat.end, NODE_FADE, NODE_FADE);
      if (level > frame.nodeLevel[beat.node]) frame.nodeLevel[beat.node] = level;
      if (beat.kind === 'work' && at >= beat.start && at <= beat.end) {
        frame.nodeWork[beat.node] = (at - beat.start) * WORK_TURNS_PER_SECOND;
      }
    } else if (beat.kind === 'verdict') {
      const strength = at >= beat.start ? Math.max(0, 1 - (at - beat.start) / VERDICT_FADE) : 0;
      if (strength > frame.nodeVerdict[beat.node]) {
        frame.nodeVerdict[beat.node] = strength;
        frame.nodeFailed[beat.node] = beat.passed ? 0 : 1;
      }
    } else if (beat.kind === 'accept') {
      if (at >= beat.start) frame.segments[beat.segment] = smooth((at - beat.start) / SEGMENT_FILL) * closing;
    } else if (at >= beat.start) {
      frame.pulse = Math.max(frame.pulse, 1 - (at - beat.start) / PULSE_FADE);
    }
  }

  return frame;
}
