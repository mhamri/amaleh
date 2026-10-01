import { createContext, useContext, onCleanup, onMount, type JSX } from 'solid-js';
import { HERO_MARK } from '../../lib/brand';
import { MODELS, type ModelId, type ModelIdentity } from '../../lib/models';
import { asset } from '../../lib/paths';
import { WORKERS, WORKER_NAMES, REPAIR, DECISION, joinNames } from '../../lib/pool';
import {
  heroScene,
  linkPoint,
  TILE,
  type Scene,
  type SceneDirection,
  type SceneLink,
  type SceneLinkKind,
  type SceneNode,
  type ScenePool,
} from '../../lib/hero-scene';
import {
  emptyFrame,
  fillFrame,
  heroStory,
  NO_HEAD,
  STILL_SECONDS,
  type SceneFrame,
  type Story,
} from '../../lib/hero-story';

const FAMILY_BY_IDENTITY = new Map<ModelIdentity, ModelId>(
  Object.entries(MODELS).map(([key, value]) => [value, key as ModelId]),
);

function familyOf(identity: ModelIdentity): ModelId {
  const key = FAMILY_BY_IDENTITY.get(identity);
  if (!key) {
    throw new Error(
      `website/src/components/landing/HeroCanvas.tsx cannot find the family of '${identity.name}' in website/src/lib/models.ts. ` +
      `Add that identity to MODELS in website/src/lib/models.ts before building.`,
    );
  }
  return key;
}

const POOL: ScenePool = {
  workers: WORKERS.map((identity) => ({ family: familyOf(identity), name: identity.name })),
  deep: [{ family: familyOf(REPAIR), name: REPAIR.name }],
  decision: { family: familyOf(DECISION), name: DECISION.name },
};

const SCENES: Record<SceneDirection, Scene> = {
  wide: heroScene(POOL, 'wide'),
  narrow: heroScene(POOL, 'narrow'),
};

const STORIES: Record<SceneDirection, Story> = {
  wide: heroStory(SCENES.wide),
  narrow: heroStory(SCENES.narrow),
};

const STILL_FRAMES: Record<SceneDirection, SceneFrame> = {
  wide: fillFrame(STORIES.wide, STILL_SECONDS, emptyFrame(SCENES.wide)),
  narrow: fillFrame(STORIES.narrow, STILL_SECONDS, emptyFrame(SCENES.narrow)),
};

const LINK_STROKE = { near: 0.032, far: 0.022 };
const LINK_OPACITY = { near: 0.3, far: 0.18, active: 0.7 };
const PACKET_RADIUS = 0.07;
const TILE_EDGE = 0.04;
const RING_EDGE = 0.05;
const RING_REST_OPACITY = 0.5;
const SEGMENT_GAP_TURNS = 0.008;
const SEGMENT_OFFSET = 0.5;
const MARK_SIDE = 1;
const MONOGRAM_SIZE = 0.26;
const LABEL_OUTLINE = 0.35;
const CURVE_STEPS = 8;
const LINK_REACH = 0.55;
const TILE_REACH = 0.9;
const PACKET_TAIL = 0.35;
const PASS_VARIABLE = '--color-secondary';
const FAIL_VARIABLE = '--color-error';

const tileClipId = (direction: SceneDirection, index: number) =>
  `hero-tile-clip-${direction}-${index}`;

const KIND_VARIABLE: Record<SceneLinkKind, string> = {
  host: '--color-primary',
  dispatch: '--color-primary',
  review: '--color-secondary',
  decision: '--color-accent',
  escalation: '--color-warning',
};

const bareVar = (value: string) => value.replace(/^var\(/, '').replace(/\)$/, '');

const edgeHue = (link: SceneLink): string =>
  link.hueFamily ? bareVar(MODELS[link.hueFamily as ModelId].hue) : KIND_VARIABLE[link.kind];

const nodeHue = (node: SceneNode): string =>
  node.family ? bareVar(MODELS[node.family as ModelId].hue) : '--color-primary';

const SCENE_VARIABLES = [
  ...new Set([
    '--color-base-100',
    '--color-line',
    PASS_VARIABLE,
    FAIL_VARIABLE,
    ...Object.values(KIND_VARIABLE),
    ...Object.values(MODELS).map((identity) => bareVar(identity.hue)),
  ]),
];

const ARIA_LABEL =
  `Claude Code or Codex runs the coordinator, which hands chunks of work to the Flash worker families ${joinNames(WORKER_NAMES)}. ` +
  `Workers put bounded questions to ${DECISION.name}. A model from another Flash family reviews each finished chunk, ` +
  `a chunk that keeps failing its repairs escalates to ${REPAIR.name}, and accepted chunks travel back to the coordinator.`;

const HUB_INDEX = SCENES.wide.nodes.findIndex((node) => node.role === 'coordinator');
const TILE_INDICES = SCENES.wide.nodes.flatMap((node, index) => (node.role === 'coordinator' ? [] : [index]));
const TILE_COUNT = TILE_INDICES.length;
const LINK_COUNT = SCENES.wide.links.length;
const WORKER_COUNT = POOL.workers.length;

const rounded = (value: number) => Number(value.toFixed(3));

const linkPath = (link: SceneLink) =>
  `M${rounded(link.x1)} ${rounded(link.y1)}Q${rounded(link.cx)} ${rounded(link.cy)} ${rounded(link.x2)} ${rounded(link.y2)}`;

function segmentPath(hub: SceneNode, segment: number): string {
  const point = (turn: number) => {
    const angle = turn * 2 * Math.PI - Math.PI / 2;
    return `${rounded(hub.x + hub.r * Math.cos(angle))} ${rounded(hub.y + hub.r * Math.sin(angle))}`;
  };
  const start = (segment - SEGMENT_OFFSET) / WORKER_COUNT + SEGMENT_GAP_TURNS;
  const end = (segment + 1 - SEGMENT_OFFSET) / WORKER_COUNT - SEGMENT_GAP_TURNS;
  return `M${point(start)}A${hub.r} ${hub.r} 0 ${end - start > 0.5 ? 1 : 0} 1 ${point(end)}`;
}

type Palette = Record<string, [number, number, number]>;

type SceneArrays = {
  hub: Float32Array;
  hubColor: Float32Array;
  tilePositions: Float32Array;
  tileColors: Float32Array;
  linkEnds: Float32Array;
  linkControls: Float32Array;
  linkColors: Float32Array;
  linkShapes: Float32Array;
};

function sceneArrays(scene: Scene, palette: Palette): SceneArrays {
  const hub = scene.nodes[HUB_INDEX];
  const arrays: SceneArrays = {
    hub: new Float32Array([hub.x, hub.y, hub.r]),
    hubColor: new Float32Array(palette[nodeHue(hub)]),
    tilePositions: new Float32Array(TILE_COUNT * 2),
    tileColors: new Float32Array(TILE_COUNT * 3),
    linkEnds: new Float32Array(LINK_COUNT * 4),
    linkControls: new Float32Array(LINK_COUNT * 2),
    linkColors: new Float32Array(LINK_COUNT * 3),
    linkShapes: new Float32Array(LINK_COUNT * 2),
  };
  TILE_INDICES.forEach((nodeIndex, i) => {
    const node = scene.nodes[nodeIndex];
    arrays.tilePositions[i * 2] = node.x;
    arrays.tilePositions[i * 2 + 1] = node.y;
    arrays.tileColors.set(palette[nodeHue(node)], i * 3);
  });
  scene.links.forEach((link, i) => {
    arrays.linkEnds.set([link.x1, link.y1, link.x2, link.y2], i * 4);
    arrays.linkControls.set([link.cx, link.cy], i * 2);
    arrays.linkColors.set(palette[edgeHue(link)], i * 3);
    arrays.linkShapes.set([link.weight, link.near ? 1 : 0.6], i * 2);
  });
  return arrays;
}

const VERTEX_SOURCE = `
attribute vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAGMENT_SOURCE = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uOrigin;
uniform float uScale;
uniform float uHeight;
uniform float uTime;
uniform vec3 uBase;
uniform vec3 uLine;
uniform vec3 uPass;
uniform vec3 uFail;
uniform vec3 uHub;
uniform vec3 uHubColor;
uniform float uPulse;
uniform float uSegment[${WORKER_COUNT}];
uniform vec2 uTile[${TILE_COUNT}];
uniform vec3 uTileColor[${TILE_COUNT}];
uniform vec4 uTileState[${TILE_COUNT}];
uniform vec4 uLinkEnds[${LINK_COUNT}];
uniform vec2 uLinkControl[${LINK_COUNT}];
uniform vec3 uLinkColor[${LINK_COUNT}];
uniform vec2 uLinkShape[${LINK_COUNT}];
uniform vec3 uLinkState[${LINK_COUNT}];

const float TAU = 6.2831853;

float glow(float d, float sigma){
  return exp(-(d * d) / (2.0 * sigma * sigma));
}

vec2 bezier(vec2 a, vec2 c, vec2 b, float t){
  return mix(mix(a, c, t), mix(c, b, t), t);
}

float roundedBox(vec2 q, float halfSide, float corner){
  vec2 d = abs(q) - (halfSide - corner);
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - corner;
}

void main(){
  vec2 p = (gl_FragCoord.xy - uOrigin) / uScale;
  p.y = uHeight - p.y;

  vec3 color = uBase;

  vec2 drift = vec2(p.x, p.y + uTime * 0.05);
  vec2 cell = abs(fract(drift) - 0.5);
  color += uLine * 0.03 * glow(min(cell.x, cell.y), 0.015);

  for (int i = 0; i < ${LINK_COUNT}; i++){
    vec2 a = uLinkEnds[i].xy;
    vec2 b = uLinkEnds[i].zw;
    vec2 c = uLinkControl[i];
    vec2 lowest = min(a, min(b, c)) - ${LINK_REACH.toFixed(2)};
    vec2 highest = max(a, max(b, c)) + ${LINK_REACH.toFixed(2)};
    if (p.x < lowest.x || p.y < lowest.y || p.x > highest.x || p.y > highest.y) continue;

    float nearest = 100.0;
    float along = 0.0;
    vec2 previous = a;
    for (int j = 1; j <= ${CURVE_STEPS}; j++){
      vec2 next = bezier(a, c, b, float(j) / ${CURVE_STEPS.toFixed(1)});
      vec2 edge = next - previous;
      vec2 toPixel = p - previous;
      float h = clamp(dot(toPixel, edge) / max(dot(edge, edge), 1e-5), 0.0, 1.0);
      vec2 offset = toPixel - edge * h;
      float squared = dot(offset, offset);
      if (squared < nearest){
        nearest = squared;
        along = (float(j) - 1.0 + h) / ${CURVE_STEPS.toFixed(1)};
      }
      previous = next;
    }
    float rail = sqrt(nearest);

    vec3 hue = uLinkColor[i];
    float weight = uLinkShape[i].x;
    float near = uLinkShape[i].y;
    float level = uLinkState[i].x;
    float head = uLinkState[i].y;
    float direction = uLinkState[i].z;
    float core = glow(rail, 0.014 + 0.012 * weight);
    float halo = glow(rail, 0.075);

    color += hue * weight * near * 0.24 * core;
    color += hue * level * (0.40 * core + 0.14 * halo);

    if (head >= 0.0){
      float behind = (head - along) * direction;
      float tail = step(0.0, behind) * (1.0 - smoothstep(0.0, ${PACKET_TAIL.toFixed(2)}, behind));
      float present = smoothstep(0.0, 0.06, head) * (1.0 - smoothstep(0.94, 1.0, head));
      float toHead = length(p - bezier(a, c, b, head));
      color += hue * tail * (0.70 * core + 0.28 * halo);
      color += present * (mix(hue, vec3(1.0), 0.55) * 0.95 * glow(toHead, 0.05) + hue * 0.30 * glow(toHead, 0.17));
    }
  }

  vec2 fromHub = p - uHub.xy;
  float hubDistance = length(fromHub);
  if (hubDistance < uHub.z + 1.2){
    float edge = abs(hubDistance - uHub.z);
    float turn = fract(atan(fromHub.y, fromHub.x) / TAU + 0.25);
    float slot = mod(turn * ${WORKER_COUNT.toFixed(1)} + ${SEGMENT_OFFSET.toFixed(1)}, ${WORKER_COUNT.toFixed(1)});
    float index = floor(slot);
    float within = fract(slot);
    float filled = 0.0;
    for (int i = 0; i < ${WORKER_COUNT}; i++){
      if (abs(float(i) - index) < 0.5) filled = uSegment[i];
    }
    float gap = ${(SEGMENT_GAP_TURNS * WORKER_COUNT).toFixed(4)};
    float body = smoothstep(0.0, gap, within) * (1.0 - smoothstep(1.0 - gap, 1.0, within));
    float lit = ${RING_REST_OPACITY.toFixed(2)} + 0.50 * filled + 0.45 * uPulse;
    color += uHubColor * lit * (0.60 * body * glow(edge, 0.030) + 0.24 * glow(edge, 0.085));
    color += uHubColor * (0.05 + 0.02 * sin(uTime * 1.1) + 0.10 * uPulse) * glow(hubDistance, uHub.z * 0.8);
    color += uHubColor * uPulse * 0.35 * glow(hubDistance - uHub.z - (1.0 - uPulse) * 0.35, 0.05);
  }

  for (int i = 0; i < ${TILE_COUNT}; i++){
    vec2 q = p - uTile[i];
    float edge = roundedBox(q, ${TILE.half.toFixed(2)}, ${TILE.radius.toFixed(2)});
    if (edge > ${TILE_REACH.toFixed(2)}) continue;
    float outside = max(edge, 0.0);
    vec3 hue = uTileColor[i];
    float level = uTileState[i].x;
    float work = uTileState[i].y;
    float verdict = uTileState[i].z;
    float breathe = 0.85 + 0.15 * sin(uTime * 1.1 + float(i) * 1.7);
    color += hue * (0.16 * breathe + 0.36 * level) * glow(outside, 0.07 + 0.05 * level);

    if (work >= 0.0){
      float lag = fract(work - atan(q.y, q.x) / TAU);
      color += mix(hue, vec3(1.0), 0.35) * level * 0.9 * exp(-lag * 4.0) * glow(edge - 0.07, 0.022);
    }
    if (verdict > 0.0){
      vec3 verdictHue = mix(uPass, uFail, uTileState[i].w);
      color += verdictHue * verdict * (0.55 * glow(edge - (1.0 - verdict) * 0.30, 0.045) + 0.25 * glow(outside, 0.16));
    }
  }

  gl_FragColor = vec4(color, 1.0);
}`;

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

function buildProgram(gl: WebGLRenderingContext) {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
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

function readPalette(host: HTMLElement, variables: string[]) {
  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  // The reduced-motion rule in style.css gives every element a 0.01ms transition, and a colour read mid-transition returns the previous colour.
  probe.style.transitionProperty = 'none';
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
  const palette: Palette = {};
  for (const variable of variables) palette[variable] = read(variable);
  probe.remove();
  return palette;
}

const MAX_DEVICE_PIXEL_RATIO = 2;

type HeroParts = {
  registerBox: (direction: SceneDirection, element: SVGSVGElement) => void;
  registerFrame: (direction: SceneDirection, element: SVGGElement) => void;
};

const HeroPartsContext = createContext<HeroParts>();

export function HeroSceneBox(props: { direction: SceneDirection; class?: string }) {
  const parts = useContext(HeroPartsContext);
  const scene = SCENES[props.direction];
  return (
    <div
      class={`relative ${props.class ?? ''}`}
      style={{ 'aspect-ratio': `${scene.width} / ${scene.height}` }}
    >
      <SceneSvg
        scene={scene}
        onMountBox={(element) => parts?.registerBox(scene.direction, element)}
        onMountFrame={(element) => parts?.registerFrame(scene.direction, element)}
      />
    </div>
  );
}

function SceneSvg(props: {
  scene: Scene;
  onMountBox: (element: SVGSVGElement) => void;
  onMountFrame: (element: SVGGElement) => void;
}) {
  const scene = props.scene;
  const still = STILL_FRAMES[scene.direction];
  const hub = scene.nodes[HUB_INDEX];
  return (
    <svg
      ref={(element) => props.onMountBox(element)}
      data-hero-layout={scene.direction}
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      class="absolute inset-0 size-full"
      role="img"
      aria-label={ARIA_LABEL}
    >
      <defs>
        {scene.nodes.map((node, index) =>
          node.family && node.labelBox ? (
            <clipPath id={tileClipId(scene.direction, index)} clipPathUnits="userSpaceOnUse">
              <rect
                x={node.tile.x}
                y={node.tile.y}
                width={node.tile.width}
                height={node.tile.height}
                rx={TILE.radius}
              />
            </clipPath>
          ) : null,
        )}
      </defs>
      <g
        ref={(element) => props.onMountFrame(element)}
        data-hero-frame={scene.direction}
        class="transition-opacity duration-500 ease-out-soft"
      >
        {scene.links.map((link, index) => (
          <path
            data-link={`${link.from}-${link.to}`}
            data-kind={link.kind}
            d={linkPath(link)}
            fill="none"
            stroke={`var(${edgeHue(link)})`}
            stroke-width={(link.near ? LINK_STROKE.near : LINK_STROKE.far) * link.weight}
            stroke-linecap="round"
            opacity={rounded(
              (link.near ? LINK_OPACITY.near : LINK_OPACITY.far) + LINK_OPACITY.active * still.linkLevel[index],
            )}
          />
        ))}
        <circle
          data-role="coordinator"
          cx={hub.x}
          cy={hub.y}
          r={hub.r}
          fill="var(--color-base-100)"
        />
        {Array.from({ length: WORKER_COUNT }, (_, segment) => (
          <path
            data-segment={segment}
            d={segmentPath(hub, segment)}
            fill="none"
            stroke={`var(${nodeHue(hub)})`}
            stroke-width={RING_EDGE}
            stroke-linecap="round"
            opacity={rounded(RING_REST_OPACITY + (1 - RING_REST_OPACITY) * still.segments[segment])}
          />
        ))}
        {scene.links.map((link, index) => {
          if (still.linkHead[index] === NO_HEAD) return null;
          const [x, y] = linkPoint(link, still.linkHead[index]);
          return <circle data-packet cx={rounded(x)} cy={rounded(y)} r={PACKET_RADIUS} fill={`var(${edgeHue(link)})`} />;
        })}
      </g>
      <image
        data-hero-mark
        href={asset(HERO_MARK.publicPath)}
        x={hub.x - MARK_SIDE / 2}
        y={hub.y - MARK_SIDE / 2}
        width={MARK_SIDE}
        height={MARK_SIDE}
      />
      {scene.nodes.map((node, index) => {
        if (!node.family || !node.labelBox) return null;
        const identity = MODELS[node.family as ModelId];
        const box = node.labelBox;
        return (
          <g data-model={node.family} data-role={node.role}>
            <rect
              data-tile
              x={node.tile.x}
              y={node.tile.y}
              width={node.tile.width}
              height={node.tile.height}
              rx={TILE.radius}
              fill={identity.tileFill ?? 'var(--color-base-200)'}
            />
            <g clip-path={`url(#${tileClipId(scene.direction, index)})`}>
              {identity.logo ? (
                <image
                  href={asset(identity.logo)}
                  x={node.tile.x}
                  y={node.tile.y}
                  width={node.tile.width}
                  height={node.tile.height}
                  preserveAspectRatio="xMidYMid meet"
                />
              ) : (
                <text
                  x={node.x}
                  y={node.y}
                  font-size={`${MONOGRAM_SIZE}`}
                  font-weight="600"
                  text-anchor="middle"
                  dominant-baseline="central"
                  fill={identity.hue}
                >
                  {identity.monogram}
                </text>
              )}
            </g>
            <rect
              data-tile-edge
              x={node.tile.x}
              y={node.tile.y}
              width={node.tile.width}
              height={node.tile.height}
              rx={TILE.radius}
              fill="none"
              stroke={identity.hue}
              stroke-width={TILE_EDGE}
            />
            <text
              data-label
              x={box.x + box.width / 2}
              y={box.y + box.height / 2}
              fill="var(--color-dim)"
              stroke="var(--color-base-100)"
              stroke-width={scene.labelSize * LABEL_OUTLINE}
              stroke-linejoin="round"
              paint-order="stroke"
              font-size={`${scene.labelSize}`}
              text-anchor="middle"
              dominant-baseline="central"
            >
              {node.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function HeroCanvas(props: { children?: JSX.Element }) {
  let canvas!: HTMLCanvasElement;
  const boxes: Partial<Record<SceneDirection, SVGSVGElement>> = {};
  const frames: Partial<Record<SceneDirection, SVGGElement>> = {};
  const parts: HeroParts = {
    registerBox: (direction, element) => {
      boxes[direction] = element;
    },
    registerFrame: (direction, element) => {
      frames[direction] = element;
    },
  };

  onMount(() => {
    const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
    const program = gl ? buildProgram(gl) : null;
    const buffer = gl && program ? gl.createBuffer() : null;

    let animation = 0;
    let onScreen = false;
    let contextLost = false;
    let origin = 0;
    let seconds = STILL_SECONDS;
    let active: SceneDirection = 'wide';
    let scale = 0;
    let offsetX = 0;
    let offsetY = 0;

    const everyFrame = () => Object.values(frames).filter(Boolean) as SVGGElement[];
    const stillFrame = () => {
      for (const group of everyFrame()) group.classList.remove('opacity-0');
    };

    const stop = () => {
      if (animation) cancelAnimationFrame(animation);
      animation = 0;
    };

    const onContextLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      stop();
      stillFrame();
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
    const sizeObserver = new ResizeObserver(() => place());
    const boxObserver = new ResizeObserver(() => place());

    canvas.addEventListener('webglcontextlost', onContextLost);
    onCleanup(() => {
      stop();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      reduceQuery.removeEventListener('change', onPreferenceChange);
      document.removeEventListener('visibilitychange', onVisibility);
      observer.disconnect();
      sizeObserver.disconnect();
      boxObserver.disconnect();
      if (gl && program) gl.deleteProgram(program);
      if (gl && buffer) gl.deleteBuffer(buffer);
    });

    if (!gl || !program || !buffer) {
      stillFrame();
      return;
    }

    const palette = readPalette(canvas.parentElement ?? document.body, SCENE_VARIABLES);
    const arrays = {
      wide: sceneArrays(SCENES.wide, palette),
      narrow: sceneArrays(SCENES.narrow, palette),
    };
    const frame = emptyFrame(SCENES.wide);
    const linkState = new Float32Array(LINK_COUNT * 3);
    const tileState = new Float32Array(TILE_COUNT * 4);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.useProgram(program);
    const position = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const originUniform = uniform('uOrigin');
    const scaleUniform = uniform('uScale');
    const heightUniform = uniform('uHeight');
    const elapsed = uniform('uTime');
    const pulseUniform = uniform('uPulse');
    const segmentUniform = uniform('uSegment');
    const tileStateUniform = uniform('uTileState');
    const linkStateUniform = uniform('uLinkState');
    gl.uniform3fv(uniform('uBase'), palette['--color-base-100']);
    gl.uniform3fv(uniform('uLine'), palette['--color-line']);
    gl.uniform3fv(uniform('uPass'), palette[PASS_VARIABLE]);
    gl.uniform3fv(uniform('uFail'), palette[FAIL_VARIABLE]);
    const uploadScene = (data: SceneArrays) => {
      gl.uniform3fv(uniform('uHub'), data.hub);
      gl.uniform3fv(uniform('uHubColor'), data.hubColor);
      gl.uniform2fv(uniform('uTile'), data.tilePositions);
      gl.uniform3fv(uniform('uTileColor'), data.tileColors);
      gl.uniform4fv(uniform('uLinkEnds'), data.linkEnds);
      gl.uniform2fv(uniform('uLinkControl'), data.linkControls);
      gl.uniform3fv(uniform('uLinkColor'), data.linkColors);
      gl.uniform2fv(uniform('uLinkShape'), data.linkShapes);
    };
    const uploadFrame = () => {
      fillFrame(STORIES[active], seconds, frame);
      for (let i = 0; i < LINK_COUNT; i += 1) {
        linkState[i * 3] = frame.linkLevel[i];
        linkState[i * 3 + 1] = frame.linkHead[i];
        linkState[i * 3 + 2] = frame.linkDirection[i];
      }
      TILE_INDICES.forEach((nodeIndex, i) => {
        tileState[i * 4] = frame.nodeLevel[nodeIndex];
        tileState[i * 4 + 1] = frame.nodeWork[nodeIndex];
        tileState[i * 4 + 2] = frame.nodeVerdict[nodeIndex];
        tileState[i * 4 + 3] = frame.nodeFailed[nodeIndex];
      });
      gl.uniform3fv(linkStateUniform, linkState);
      gl.uniform4fv(tileStateUniform, tileState);
      gl.uniform1fv(segmentUniform, frame.segments);
      gl.uniform1f(pulseUniform, frame.pulse);
    };
    let uploaded: SceneDirection | null = null;

    const draw = () => {
      if (contextLost || canvas.width < 1 || canvas.height < 1 || scale <= 0) return;
      if (uploaded !== active) {
        uploadScene(arrays[active]);
        gl.uniform1f(heightUniform, SCENES[active].height);
        uploaded = active;
      }
      uploadFrame();
      gl.viewport(0, 0, canvas.width, canvas.height);
      const density = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
      gl.uniform2f(originUniform, offsetX * density, offsetY * density);
      gl.uniform1f(scaleUniform, scale * density);
      gl.uniform1f(elapsed, seconds);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const resize = () => {
      const box = canvas.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) return;
      const density = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
      const width = Math.max(1, Math.round(box.width * density));
      const height = Math.max(1, Math.round(box.height * density));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };

    const place = () => {
      resize();
      const canvasBox = canvas.getBoundingClientRect();
      const wide = boxes.wide?.getBoundingClientRect();
      const narrow = boxes.narrow?.getBoundingClientRect();
      const scene = wide && wide.width > 0 ? SCENES.wide : narrow && narrow.width > 0 ? SCENES.narrow : null;
      const drawn = wide && wide.width > 0 ? wide : narrow;
      if (!scene || !drawn) {
        scale = 0;
        return;
      }
      active = scene.direction;
      scale = drawn.width / scene.width;
      offsetX = drawn.left - canvasBox.left;
      offsetY = canvasBox.bottom - drawn.bottom;
      draw();
    };

    const shouldAnimate = () =>
      onScreen && !document.hidden && !reduceQuery.matches && !contextLost;

    const tick = (now: number) => {
      if (!shouldAnimate()) {
        animation = 0;
        return;
      }
      if (!origin) origin = now;
      seconds = (now - origin) / 1000;
      draw();
      animation = requestAnimationFrame(tick);
    };

    function sync() {
      if (shouldAnimate()) {
        for (const group of everyFrame()) group.classList.add('opacity-0');
        if (!animation) animation = requestAnimationFrame(tick);
        return;
      }
      stop();
      if (reduceQuery.matches || contextLost) {
        seconds = STILL_SECONDS;
        stillFrame();
      }
      draw();
    }

    reduceQuery.addEventListener('change', onPreferenceChange);
    document.addEventListener('visibilitychange', onVisibility);
    observer.observe(canvas);
    sizeObserver.observe(canvas);
    for (const box of Object.values(boxes)) if (box) boxObserver.observe(box);
    place();
    sync();
  });

  return (
    <HeroPartsContext.Provider value={parts}>
      <canvas ref={canvas} class="absolute inset-0 -z-10 size-full" aria-hidden="true" />
      {props.children}
    </HeroPartsContext.Provider>
  );
}
