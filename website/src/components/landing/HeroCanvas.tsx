import { createContext, useContext, onCleanup, onMount, type JSX } from 'solid-js';
import { MODELS, type ModelId, type ModelIdentity } from '../../lib/models';
import { asset } from '../../lib/paths';
import { WORKERS, WORKER_NAMES, REPAIR, DECISION, joinNames } from '../../lib/pool';
import {
  heroScene,
  TILE,
  type Scene,
  type SceneDirection,
  type SceneLink,
  type SceneLinkKind,
  type SceneNode,
  type ScenePool,
} from '../../lib/hero-scene';

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

const LINK_STROKE = { near: 0.032, far: 0.018 };
const RETURN_PACKET_HEAD = 0.26;
const RETURN_PACKET_TAIL = 0.11;
const RETURN_PACKET_CORE = 0.05;
const RETURN_PACKET_SPREAD = 0.18;
const RETURN_PACKET_RAIL = 0.028;
const RETURN_PACKET_TRAIL = 0.15;
const NO_RETURN = -1;
const LINK_GLOW_FADE = { above: 0.1, width: 0.06 };
const TILE_EDGE = 0.04;
const RING_EDGE = 0.05;
const MONOGRAM_SIZE = 0.26;
const FRAME_OPACITY = 0.25;

const tileClipId = (direction: SceneDirection, index: number) =>
  `hero-tile-clip-${direction}-${index}`;

const ROLE_VARIABLE: Record<SceneLinkKind, string> = {
  coordinator: '--color-primary',
  worker: '--color-secondary',
  review: '--color-secondary',
  decision: '--color-accent',
};

const bareVar = (value: string) => value.replace(/^var\(/, '').replace(/\)$/, '');

const edgeHue = (link: SceneLink): string => {
  if (link.kind === 'review') return '--color-secondary';
  if (link.hueFamily) {
    const identity = MODELS[link.hueFamily as ModelId];
    if (identity) return bareVar(identity.hue);
  }
  return ROLE_VARIABLE[link.kind];
};

const nodeHue = (node: SceneNode): string =>
  node.family ? bareVar(MODELS[node.family as ModelId].hue) : '--color-primary';

const HUE_VARIABLES = [
  ...new Set([
    '--color-primary',
    '--color-secondary',
    '--color-accent',
    ...Object.values(MODELS).map((identity) => bareVar(identity.hue)),
  ]),
];
const SCENE_VARIABLES = ['--color-base-100', '--color-line', ...HUE_VARIABLES];

const ARIA_LABEL =
  `Claude Code or Codex runs the coordinator, which hands chunks of work to the Flash worker families ${joinNames(WORKER_NAMES)}. ` +
  `Workers put bounded questions to ${DECISION.name}. A model from another Flash family reviews each finished chunk, ` +
  `a chunk that keeps failing its repairs escalates to ${REPAIR.name}, and accepted chunks travel back to the coordinator.`;

const NODE_COUNT = SCENES.wide.nodes.length;
const LINK_COUNT = SCENES.wide.links.length;

type Palette = Record<string, [number, number, number]>;

type SceneArrays = {
  nodePositions: Float32Array;
  nodeRadii: Float32Array;
  nodeColors: Float32Array;
  linkEnds: Float32Array;
  linkColors: Float32Array;
  linkPhases: Float32Array;
  linkReturns: Float32Array;
  linkNear: Float32Array;
  linkClamp: Float32Array;
  linkWeight: Float32Array;
};

function sceneArrays(scene: Scene, palette: Palette): SceneArrays {
  const arrays: SceneArrays = {
    nodePositions: new Float32Array(NODE_COUNT * 2),
    nodeRadii: new Float32Array(NODE_COUNT),
    nodeColors: new Float32Array(NODE_COUNT * 3),
    linkEnds: new Float32Array(LINK_COUNT * 4),
    linkColors: new Float32Array(LINK_COUNT * 3),
    linkPhases: new Float32Array(LINK_COUNT),
    linkReturns: new Float32Array(LINK_COUNT),
    linkNear: new Float32Array(LINK_COUNT),
    linkClamp: new Float32Array(LINK_COUNT),
    linkWeight: new Float32Array(LINK_COUNT),
  };
  scene.nodes.forEach((node, i) => {
    arrays.nodePositions[i * 2] = node.x;
    arrays.nodePositions[i * 2 + 1] = node.y;
    arrays.nodeRadii[i] = node.r;
    arrays.nodeColors.set(palette[nodeHue(node)], i * 3);
  });
  scene.links.forEach((link, i) => {
    arrays.linkEnds[i * 4] = link.x1;
    arrays.linkEnds[i * 4 + 1] = link.y1;
    arrays.linkEnds[i * 4 + 2] = link.x2;
    arrays.linkEnds[i * 4 + 3] = link.y2;
    arrays.linkColors.set(palette[edgeHue(link)], i * 3);
    arrays.linkPhases[i] = link.phase;
    arrays.linkReturns[i] = link.returnPhase ?? NO_RETURN;
    arrays.linkNear[i] = link.near ? 1.0 : 0.6;
    arrays.linkWeight[i] = link.weight;
    const lower = Math.max(scene.nodes[link.from].y, scene.nodes[link.to].y);
    arrays.linkClamp[i] = lower + TILE.half + LINK_GLOW_FADE.above;
  });
  return arrays;
}

const VERTEX_SOURCE = `
attribute vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAGMENT_SOURCE = `
precision mediump float;
uniform vec2 uRes;
uniform vec2 uOrigin;
uniform float uScale;
uniform float uHeight;
uniform float uTime;
uniform vec3 uBase;
uniform vec3 uLine;
uniform vec2 uNode[${NODE_COUNT}];
uniform float uNodeRadius[${NODE_COUNT}];
uniform vec3 uNodeColor[${NODE_COUNT}];
uniform vec4 uLink[${LINK_COUNT}];
uniform vec3 uLinkColor[${LINK_COUNT}];
uniform float uLinkPhase[${LINK_COUNT}];
uniform float uLinkReturn[${LINK_COUNT}];
uniform float uLinkNear[${LINK_COUNT}];
uniform float uLinkClamp[${LINK_COUNT}];
uniform float uLinkWeight[${LINK_COUNT}];

float segmentDistance(vec2 p, vec2 a, vec2 b){
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - (a + ab * t));
}

float glow(float d, float sigma){
  return exp(-(d * d) / (2.0 * sigma * sigma));
}

void main(){
  vec2 p = (gl_FragCoord.xy - uOrigin) / uScale;
  p.y = uHeight - p.y;

  vec3 color = uBase;

  vec2 drift = vec2(p.x, p.y + uTime * 0.05);
  vec2 cell = abs(fract(drift) - 0.5);
  color += uLine * 0.03 * glow(min(cell.x, cell.y), 0.015);

  for (int i = 0; i < ${LINK_COUNT}; i++){
    vec2 a = uLink[i].xy;
    vec2 b = uLink[i].zw;
    float weight = uLinkWeight[i];
    float rail = segmentDistance(p, a, b);
    float near = uLinkNear[i];
    float glowClamp = 1.0 - smoothstep(uLinkClamp[i] - ${LINK_GLOW_FADE.width.toFixed(2)}, uLinkClamp[i] + ${LINK_GLOW_FADE.width.toFixed(2)}, p.y);

    color += uLinkColor[i] * weight * (0.22 + 0.18 * near) * glow(rail, weight * (0.048 + 0.042 * (1.0 - near))) * glowClamp;
    color += uLinkColor[i] * weight * (0.38 + 0.30 * near) * glow(rail, weight * (0.027 + 0.024 * (1.0 - near))) * glowClamp;

    float travel = fract(uTime * 0.2 + uLinkPhase[i]);
    float eased = travel * travel * (3.0 - 2.0 * travel);
    vec2 packet = a + (b - a) * eased;
    float alive = sin(travel * 3.1415926);
    float toPacket = length(p - packet);
    float nearBoost = 1.0 + 0.2 * near;
    color += uLinkColor[i] * alive * nearBoost * (0.32 * glow(toPacket, 0.055) + 0.14 * glow(toPacket, 0.20)) * glowClamp;
    color += uLinkColor[i] * weight * alive * nearBoost * 0.18 * glow(rail, 0.032) * smoothstep(0.5, 0.0, toPacket) * glowClamp;

    if (uLinkReturn[i] >= 0.0) {
      float back = fract(uTime * 0.2 + uLinkReturn[i]);
      float backEased = back * back * (3.0 - 2.0 * back);
      vec2 backPacket = b + (a - b) * backEased;
      float backAlive = sin(back * 3.1415926);
      float toBack = length(p - backPacket);
      color += uLinkColor[i] * backAlive * nearBoost * (${RETURN_PACKET_HEAD.toFixed(2)} * glow(toBack, ${RETURN_PACKET_CORE.toFixed(2)}) + ${RETURN_PACKET_TAIL.toFixed(2)} * glow(toBack, ${RETURN_PACKET_SPREAD.toFixed(2)})) * glowClamp;
      color += uLinkColor[i] * weight * backAlive * nearBoost * ${RETURN_PACKET_TRAIL.toFixed(2)} * glow(rail, ${RETURN_PACKET_RAIL.toFixed(2)}) * smoothstep(0.5, 0.0, toBack) * glowClamp;
    }
  }

  for (int i = 0; i < ${NODE_COUNT}; i++){
    float toNode = length(p - uNode[i]);
    float radius = uNodeRadius[i];
    float breathe = 0.86 + 0.14 * sin(uTime * 1.1 + float(i) * 1.7);
    color += uNodeColor[i] * 0.24 * glow(toNode, radius * 0.95) * breathe;
    color += uNodeColor[i] * 0.30 * glow(abs(toNode - radius), radius * 0.10);
    color += uNodeColor[i] * 0.36 * glow(abs(toNode - radius), radius * 0.05);
    color = mix(color, uBase, 0.62 * smoothstep(radius * 0.95, radius * 0.72, toNode));
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
        opacity={FRAME_OPACITY}
      >
        {scene.links.map((link) => (
          <line
            data-link={`${link.from}-${link.to}`}
            data-kind={link.kind}
            x1={link.x1}
            y1={link.y1}
            x2={link.x2}
            y2={link.y2}
            stroke={`var(${edgeHue(link)})`}
            stroke-width={(link.near ? LINK_STROKE.near : LINK_STROKE.far) * link.weight}
            opacity={link.near ? 0.7 : 0.3}
          />
        ))}
        {scene.nodes.map((node) =>
          node.family ? null : (
            <circle
              data-role="coordinator"
              cx={node.x}
              cy={node.y}
              r={node.r}
              fill="var(--color-base-100)"
              stroke={`var(${nodeHue(node)})`}
              stroke-width={RING_EDGE}
            />
          ),
        )}
      </g>
      {scene.nodes.map((node, index) => {
        if (!node.family || !node.labelBox) return null;
        const identity = MODELS[node.family as ModelId];
        const patch = node.labelBox;
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
            <rect
              data-label-patch
              x={patch.x}
              y={patch.y}
              width={patch.width}
              height={patch.height}
              fill="var(--color-base-100)"
            />
            <text
              data-label
              x={patch.x + patch.width / 2}
              y={patch.y + patch.height / 2}
              fill="var(--color-dim)"
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

    let frame = 0;
    let onScreen = false;
    let contextLost = false;
    let origin = 0;
    let seconds = 0;
    let active: SceneDirection = 'wide';
    let scale = 0;
    let offsetX = 0;
    let offsetY = 0;

    const everyFrame = () => Object.values(frames).filter(Boolean) as SVGGElement[];
    const stillFrame = () => {
      for (const group of everyFrame()) group.classList.remove('opacity-0');
    };

    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
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

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.useProgram(program);
    const position = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const resolution = uniform('uRes');
    const originUniform = uniform('uOrigin');
    const scaleUniform = uniform('uScale');
    const heightUniform = uniform('uHeight');
    const elapsed = uniform('uTime');
    gl.uniform3fv(uniform('uBase'), palette['--color-base-100']);
    gl.uniform3fv(uniform('uLine'), palette['--color-line']);
    const upload = (data: SceneArrays) => {
      gl.uniform2fv(uniform('uNode'), data.nodePositions);
      gl.uniform1fv(uniform('uNodeRadius'), data.nodeRadii);
      gl.uniform3fv(uniform('uNodeColor'), data.nodeColors);
      gl.uniform4fv(uniform('uLink'), data.linkEnds);
      gl.uniform3fv(uniform('uLinkColor'), data.linkColors);
      gl.uniform1fv(uniform('uLinkPhase'), data.linkPhases);
      gl.uniform1fv(uniform('uLinkReturn'), data.linkReturns);
      gl.uniform1fv(uniform('uLinkNear'), data.linkNear);
      gl.uniform1fv(uniform('uLinkClamp'), data.linkClamp);
      gl.uniform1fv(uniform('uLinkWeight'), data.linkWeight);
    };
    let uploaded: SceneDirection | null = null;

    const draw = () => {
      if (contextLost || canvas.width < 1 || canvas.height < 1 || scale <= 0) return;
      if (uploaded !== active) {
        upload(arrays[active]);
        gl.uniform1f(heightUniform, SCENES[active].height);
        uploaded = active;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(resolution, canvas.width, canvas.height);
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
        for (const group of everyFrame()) group.classList.add('opacity-0');
        if (!frame) frame = requestAnimationFrame(tick);
        return;
      }
      stop();
      if (reduceQuery.matches || contextLost) stillFrame();
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
