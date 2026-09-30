import { MODELS, type ModelId } from '../../lib/models';
import type { HeroLink, HeroPoint, HeroScene } from '../../lib/hero-layout';

const MAX_DEVICE_PIXEL_RATIO = 2;
const PACKET_PERIOD = 0.2;
const REVIEW_WEIGHT = 0.7;
const FULL_WEIGHT = 1;

const RAIL_SIGMA = 2.6;
const RAIL_CORE = 1.3;
const RAIL_WIDE = 5;
const RAIL_GLOW = 0.30;
const RAIL_BRIGHT = 0.22;
const RAIL_HALO = 0.10;
const PACKET_SIGMA = 2.8;
const PACKET_WIDE = 10.5;
const PACKET_BRIGHT = 0.32;
const PACKET_HALO = 0.14;
const EDGE_FADE_PX = 24;
const GRID_SIGMA = 0.75;
const GRID_BRIGHT = 0.03;
const GRID_DRIFT = 0.05;
const NODE_HALO = 0.24;
const NODE_RING = 0.3;
const NODE_CORE = 0.36;
const NODE_FADE = 0.62;
const NODE_BREATH = 0.14;
const NODE_RATE = 1.1;

const VERTEX_SOURCE = `
attribute vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const f = (value: number) => value.toFixed(3);

const fragmentSource = (segments: number, packets: number, nodes: number) => `
precision highp float;
uniform vec2 uRes;
uniform vec2 uScene;
uniform float uTime;
uniform float uFade;
uniform vec3 uLine;
uniform vec4 uSegment[${segments}];
uniform vec3 uSegmentColor[${segments}];
uniform vec2 uPacket[${packets}];
uniform vec3 uPacketColor[${packets}];
uniform vec4 uNode[${nodes}];
uniform vec3 uNodeColor[${nodes}];

float segmentDistance(vec2 p, vec2 a, vec2 b){
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - (a + ab * t));
}

float glow(float d, float sigma){
  return exp(-(d * d) / (2.0 * sigma * sigma));
}

void main(){
  float scale = min(uRes.x / uScene.x, uRes.y / uScene.y);
  vec2 inset = (uRes - uScene * scale) * 0.5;
  vec2 p = (gl_FragCoord.xy - inset) / scale;
  p.y = uScene.y - p.y;

  vec3 color = vec3(0.0);

  vec2 drift = vec2(p.x, p.y + uTime * ${f(GRID_DRIFT)});
  vec2 cell = abs(fract(drift) - 0.5);
  color += uLine * ${f(GRID_BRIGHT)} * glow(min(cell.x, cell.y), ${f(GRID_SIGMA)});

  float rail = 0.0;
  vec3 railColor = vec3(0.0);
  for (int i = 0; i < ${segments}; i++){
    float d = segmentDistance(p, uSegment[i].xy, uSegment[i].zw);
    float lit = ${f(RAIL_GLOW)} * glow(d, ${f(RAIL_SIGMA)}) + ${f(RAIL_BRIGHT)} * glow(d, ${f(RAIL_CORE)}) + ${f(RAIL_HALO)} * glow(d, ${f(RAIL_WIDE)});
    if (lit > rail){ rail = lit; railColor = uSegmentColor[i]; }
  }
  color += railColor * rail;

  float packet = 0.0;
  vec3 packetColor = vec3(0.0);
  for (int i = 0; i < ${packets}; i++){
    float d = length(p - uPacket[i]);
    float lit = ${f(PACKET_BRIGHT)} * glow(d, ${f(PACKET_SIGMA)}) + ${f(PACKET_HALO)} * glow(d, ${f(PACKET_WIDE)});
    if (lit > packet){ packet = lit; packetColor = uPacketColor[i]; }
  }
  color += packetColor * packet;

  for (int i = 0; i < ${nodes}; i++){
    float toNode = length(p - uNode[i].xy);
    float radius = uNode[i].z;
    float breathe = 1.0 - ${f(NODE_BREATH)} + ${f(NODE_BREATH)} * sin(uTime * ${f(NODE_RATE)} + float(i) * 1.7);
    color += uNodeColor[i] * ${f(NODE_HALO)} * glow(toNode, radius * 0.95) * breathe;
    color += uNodeColor[i] * ${f(NODE_RING)} * glow(abs(toNode - radius), radius * 0.1);
    color += uNodeColor[i] * ${f(NODE_CORE)} * glow(abs(toNode - radius), radius * 0.05);
    color = mix(color, vec3(0.0), ${f(NODE_FADE)} * smoothstep(radius * 0.95, radius * 0.72, toNode));
  }

  float toEdge = min(min(gl_FragCoord.x, uRes.x - gl_FragCoord.x), min(gl_FragCoord.y, uRes.y - gl_FragCoord.y));
  color *= smoothstep(0.0, uFade, toEdge);

  gl_FragColor = vec4(color, 1.0);
}`;

type Path = { points: HeroPoint[]; lengths: number[]; total: number };

type Segment = { a: HeroPoint; b: HeroPoint; color: string; weight: number };

type Packet = { path: Path; phase: number; reverse: boolean; color: string };

function measure(points: HeroPoint[]): Path {
  const lengths = [0];
  let total = 0;
  for (let at = 1; at < points.length; at += 1) {
    const before = points[at - 1];
    const after = points[at];
    total += Math.hypot(after.x - before.x, after.y - before.y);
    lengths.push(total);
  }
  return { points, lengths, total };
}

function along(path: Path, t: number): HeroPoint {
  if (path.total <= 0) return path.points[0];
  const target = Math.min(Math.max(t, 0), 1) * path.total;
  let at = 1;
  while (at < path.lengths.length - 1 && path.lengths[at] < target) at += 1;
  const before = path.lengths[at - 1];
  const after = path.lengths[at];
  const share = after > before ? (target - before) / (after - before) : 0;
  const start = path.points[at - 1];
  const end = path.points[at];
  return { x: start.x + (end.x - start.x) * share, y: start.y + (end.y - start.y) * share };
}

const bare = (value: string) => value.replace(/^var\(/, '').replace(/\)$/, '');

const SCENE_VARIABLES = [
  '--color-line',
  '--color-primary',
  '--color-secondary',
  '--color-accent',
  ...Object.values(MODELS).map((identity) => bare(identity.hue)),
];

function readPalette(host: HTMLElement, variables: string[]) {
  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  host.appendChild(probe);
  const read = (variable: string): [number, number, number] => {
    probe.style.color = `var(${variable})`;
    const channels = getComputedStyle(probe)
      .color.match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number);
    return channels && channels.length === 3
      ? [channels[0] / 255, channels[1] / 255, channels[2] / 255]
      : [0.5, 0.5, 0.5];
  };
  const palette: Record<string, [number, number, number]> = {};
  for (const variable of variables) palette[variable] = read(variable);
  probe.remove();
  return palette;
}

const hueOf = (family: string | undefined) => (family ? MODELS[family as ModelId]?.hue : undefined);

function linkHue(scene: HeroScene, link: HeroLink): string {
  if (link.kind === 'review') return 'var(--color-secondary)';
  const from = scene.nodes.find((node) => node.id === link.from);
  const to = scene.nodes.find((node) => node.id === link.to);
  const end = from?.family ? from : to;
  return hueOf(end?.family) ?? 'var(--color-primary)';
}

function nodeHue(scene: HeroScene, id: string): string {
  const node = scene.nodes.find((candidate) => candidate.id === id);
  return hueOf(node?.family) ?? 'var(--color-primary)';
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function buildProgram(gl: WebGLRenderingContext, segments: number, packets: number, nodes: number) {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource(segments, packets, nodes));
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

export function attachHeroGlow(options: {
  canvas: HTMLCanvasElement;
  scene: HeroScene;
  fallback: () => SVGGElement | undefined;
}): { stop: () => void } {
  const canvas = options.canvas;
  const scene = options.scene;

  const segments: Segment[] = [];
  for (const link of scene.links) {
    const color = linkHue(scene, link);
    const weight = link.kind === 'review' ? REVIEW_WEIGHT : FULL_WEIGHT;
    for (let at = 1; at < link.points.length; at += 1) {
      segments.push({
        a: link.points[at - 1],
        b: link.points[at],
        color,
        weight,
      });
    }
  }

  const packets: Packet[] = scene.links.map((link, index) => ({
    path: measure(link.points),
    phase: (index * 0.37) % 1,
    reverse: false,
    color: linkHue(scene, link),
  }));
  for (const link of scene.links) {
    if (link.kind !== 'dispatch') continue;
    packets.push({
      path: measure(link.points),
      phase: ((packets.length * 0.37) % 1 + 0.5) % 1,
      reverse: true,
      color: nodeHue(scene, link.to),
    });
  }

  const nodeEntries = scene.nodes.map((node) => ({
    x: node.tile.x + node.tile.width / 2,
    y: node.tile.y + node.tile.height / 2,
    r: node.tile.width / 2,
    color: nodeHue(scene, node.id),
  }));

  const segmentSlots = Math.max(1, segments.length);
  const packetSlots = Math.max(1, packets.length);
  const nodeSlots = Math.max(1, nodeEntries.length);

  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
  const program = gl ? buildProgram(gl, segmentSlots, packetSlots, nodeSlots) : null;
  const buffer = gl && program ? gl.createBuffer() : null;

  let frame = 0;
  let onScreen = false;
  let contextLost = false;
  let origin = 0;
  let seconds = 0;
  let sized = false;
  let paint: () => void = () => {};

  const stopLoop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  const onContextLost = (event: Event) => {
    event.preventDefault();
    contextLost = true;
    stopLoop();
    options.fallback()?.classList.remove('opacity-0');
  };
  const onPreferenceChange = () => {
    origin = 0;
    sync();
  };
  const onVisibility = () => {
    origin = 0;
    sync();
  };

  const observer = new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1].isIntersecting;
    origin = 0;
    sync();
  });
  const sizeObserver = new ResizeObserver(() => {
    resize();
    sync();
  });

  canvas.addEventListener('webglcontextlost', onContextLost);

  const destroy = () => {
    stopLoop();
    canvas.removeEventListener('webglcontextlost', onContextLost);
    reduceQuery.removeEventListener('change', onPreferenceChange);
    document.removeEventListener('visibilitychange', onVisibility);
    observer.disconnect();
    sizeObserver.disconnect();
    if (gl && program) gl.deleteProgram(program);
    if (gl && buffer) gl.deleteBuffer(buffer);
  };

  const resize = () => {
    const box = canvas.getBoundingClientRect();
    sized = box.width >= 1 && box.height >= 1;
    if (!sized) return;
    const density = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
    const width = Math.max(1, Math.round(box.width * density));
    const height = Math.max(1, Math.round(box.height * density));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    paint();
  };

  if (!gl || !program || !buffer) {
    const watcher = new ResizeObserver(() => resize());
    watcher.observe(canvas);
    resize();
    return {
      stop: () => {
        watcher.disconnect();
        destroy();
      },
    };
  }

  const context = gl;
  const palette = readPalette(canvas.parentElement ?? document.body, SCENE_VARIABLES);
  const segmentEnds = new Float32Array(segmentSlots * 4);
  const segmentColors = new Float32Array(segmentSlots * 3);
  const packetPositions = new Float32Array(packetSlots * 2);
  const packetColors = new Float32Array(packetSlots * 3);
  const nodeData = new Float32Array(nodeSlots * 4);
  const nodeColors = new Float32Array(nodeSlots * 3);

  segments.forEach((segment, index) => {
    segmentEnds[index * 4] = segment.a.x;
    segmentEnds[index * 4 + 1] = segment.a.y;
    segmentEnds[index * 4 + 2] = segment.b.x;
    segmentEnds[index * 4 + 3] = segment.b.y;
    const colour = palette[bare(segment.color)] ?? palette['--color-primary'];
    segmentColors[index * 3] = colour[0] * segment.weight;
    segmentColors[index * 3 + 1] = colour[1] * segment.weight;
    segmentColors[index * 3 + 2] = colour[2] * segment.weight;
  });
  nodeEntries.forEach((node, index) => {
    nodeData[index * 4] = node.x;
    nodeData[index * 4 + 1] = node.y;
    nodeData[index * 4 + 2] = node.r;
    const colour = palette[bare(node.color)] ?? palette['--color-primary'];
    nodeColors[index * 3] = colour[0];
    nodeColors[index * 3 + 1] = colour[1];
    nodeColors[index * 3 + 2] = colour[2];
  });

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.useProgram(program);
  const position = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const resolution = uniform('uRes');
  const extent = uniform('uScene');
  const elapsed = uniform('uTime');
  const fade = uniform('uFade');
  const segmentUniform = uniform('uSegment');
  const segmentColorUniform = uniform('uSegmentColor');
  const packetUniform = uniform('uPacket');
  const packetColorUniform = uniform('uPacketColor');
  const nodeUniform = uniform('uNode');
  const nodeColorUniform = uniform('uNodeColor');
  gl.uniform3fv(uniform('uLine'), palette['--color-line']);
  gl.uniform2f(extent, scene.width, scene.height);
  gl.uniform4fv(segmentUniform, segmentEnds);
  gl.uniform3fv(segmentColorUniform, segmentColors);
  gl.uniform4fv(nodeUniform, nodeData);
  gl.uniform3fv(nodeColorUniform, nodeColors);

  const updatePackets = () => {
    packets.forEach((packet, index) => {
      const travel = (seconds * PACKET_PERIOD + packet.phase) % 1;
      const point = along(packet.path, packet.reverse ? 1 - travel : travel);
      const alive = Math.sin(travel * Math.PI);
      packetPositions[index * 2] = point.x;
      packetPositions[index * 2 + 1] = point.y;
      const colour = palette[bare(packet.color)] ?? palette['--color-primary'];
      packetColors[index * 3] = colour[0] * alive;
      packetColors[index * 3 + 1] = colour[1] * alive;
      packetColors[index * 3 + 2] = colour[2] * alive;
    });
    gl.uniform2fv(packetUniform, packetPositions);
    gl.uniform3fv(packetColorUniform, packetColors);
  };

  function draw() {
    if (!sized || contextLost || canvas.width < 1 || canvas.height < 1) return;
    context.viewport(0, 0, canvas.width, canvas.height);
    context.uniform2f(resolution, canvas.width, canvas.height);
    context.uniform1f(elapsed, seconds);
    context.uniform1f(fade, EDGE_FADE_PX * Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO));
    updatePackets();
    context.drawArrays(context.TRIANGLES, 0, 3);
  }
  paint = draw;

  const shouldAnimate = () =>
    sized && onScreen && !document.hidden && !reduceQuery.matches && !contextLost;

  const tick = (now: number) => {
    if (!shouldAnimate()) {
      frame = 0;
      return;
    }
    if (!origin) origin = now;
    seconds = (now - origin) / 1000;
    draw();
    frame = requestAnimationFrame(tick);
  };

  function sync() {
    if (shouldAnimate()) {
      options.fallback()?.classList.add('opacity-0');
      if (!frame) frame = requestAnimationFrame(tick);
      return;
    }
    stopLoop();
    if (reduceQuery.matches || contextLost) options.fallback()?.classList.remove('opacity-0');
    draw();
  }

  reduceQuery.addEventListener('change', onPreferenceChange);
  document.addEventListener('visibilitychange', onVisibility);
  observer.observe(canvas);
  sizeObserver.observe(canvas);
  resize();
  sync();

  return { stop: destroy };
}
