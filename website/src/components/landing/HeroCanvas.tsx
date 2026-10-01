import { onCleanup, onMount } from 'solid-js';
import { MODELS, type ModelId, type ModelIdentity } from '../../lib/models';
import { asset } from '../../lib/paths';
import { WORKERS, WORKER_NAMES, REPAIR, DECISION, joinNames } from '../../lib/pool';
import {
  heroScene,
  TILE,
  LABEL,
  type SceneLink,
  type SceneLinkKind,
  type SceneNode,
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

const SCENE = heroScene({
  workers: WORKERS.map((identity) => ({ family: familyOf(identity), name: identity.name })),
  deep: [{ family: familyOf(REPAIR), name: REPAIR.name }],
  decision: { family: familyOf(DECISION), name: DECISION.name },
}, 'wide');

const NODES = SCENE.nodes;
const LINKS = SCENE.links;

const DESIGN_WIDTH = 16;
const DESIGN_HEIGHT = 9;

const LINK_STROKE = { near: 0.032, far: 0.018 };

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

const NODE_COUNT = NODES.length;
const LINK_COUNT = LINKS.length;

const VERTEX_SOURCE = `
attribute vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAGMENT_SOURCE = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uBase;
uniform vec3 uLine;
uniform vec2 uNode[${NODE_COUNT}];
uniform float uNodeRadius[${NODE_COUNT}];
uniform vec3 uNodeColor[${NODE_COUNT}];
uniform vec4 uLink[${LINK_COUNT}];
uniform vec3 uLinkColor[${LINK_COUNT}];
uniform float uLinkPhase[${LINK_COUNT}];
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
  float scale = min(uRes.x / ${DESIGN_WIDTH}.0, uRes.y / ${DESIGN_HEIGHT}.0);
  vec2 inset = (uRes - vec2(${DESIGN_WIDTH}.0, ${DESIGN_HEIGHT}.0) * scale) * 0.5;
  vec2 p = (gl_FragCoord.xy - inset) / scale;
  p.y = ${DESIGN_HEIGHT}.0 - p.y;

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
    float glowClamp = 1.0 - smoothstep(uLinkClamp[i] - 0.06, uLinkClamp[i] + 0.06, p.y);

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
  const palette: Record<string, [number, number, number]> = {};
  for (const variable of variables) palette[variable] = read(variable);
  probe.remove();
  return palette;
}

const MAX_DEVICE_PIXEL_RATIO = 2;

export default function HeroCanvas() {
  let canvas!: HTMLCanvasElement;
  let fallback!: SVGGElement;

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

    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };

    const onContextLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      stop();
      fallback.classList.remove('opacity-0');
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
    const sizeObserver = new ResizeObserver(() => resize());

    canvas.addEventListener('webglcontextlost', onContextLost);
    onCleanup(() => {
      stop();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      reduceQuery.removeEventListener('change', onPreferenceChange);
      document.removeEventListener('visibilitychange', onVisibility);
      observer.disconnect();
      sizeObserver.disconnect();
      if (gl && program) gl.deleteProgram(program);
      if (gl && buffer) gl.deleteBuffer(buffer);
    });

    if (!gl || !program || !buffer) return;

    const palette = readPalette(canvas.parentElement ?? document.body, SCENE_VARIABLES);
    const nodePositions = new Float32Array(NODE_COUNT * 2);
    const nodeRadii = new Float32Array(NODE_COUNT);
    const nodeColors = new Float32Array(NODE_COUNT * 3);
    const linkEnds = new Float32Array(LINK_COUNT * 4);
    const linkColors = new Float32Array(LINK_COUNT * 3);
    const linkPhases = new Float32Array(LINK_COUNT);
    const linkNear = new Float32Array(LINK_COUNT);
    const linkClamp = new Float32Array(LINK_COUNT);
    const linkWeight = new Float32Array(LINK_COUNT);

    NODES.forEach((node, i) => {
      nodePositions[i * 2] = node.x;
      nodePositions[i * 2 + 1] = node.y;
      nodeRadii[i] = node.r;
      nodeColors.set(palette[nodeHue(node)], i * 3);
    });
    LINKS.forEach((link, i) => {
      linkEnds[i * 4] = link.x1;
      linkEnds[i * 4 + 1] = link.y1;
      linkEnds[i * 4 + 2] = link.x2;
      linkEnds[i * 4 + 3] = link.y2;
      linkColors.set(palette[edgeHue(link)], i * 3);
      linkPhases[i] = link.phase;
      linkNear[i] = link.near ? 1.0 : 0.6;
      linkWeight[i] = link.weight;
      const higher = Math.max(NODES[link.from].y, NODES[link.to].y);
      linkClamp[i] = higher + TILE.half + LABEL.gap * 0.5;
    });

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.useProgram(program);
    const position = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const resolution = uniform('uRes');
    const elapsed = uniform('uTime');
    gl.uniform3fv(uniform('uBase'), palette['--color-base-100']);
    gl.uniform3fv(uniform('uLine'), palette['--color-line']);
    gl.uniform2fv(uniform('uNode'), nodePositions);
    gl.uniform1fv(uniform('uNodeRadius'), nodeRadii);
    gl.uniform3fv(uniform('uNodeColor'), nodeColors);
    gl.uniform4fv(uniform('uLink'), linkEnds);
    gl.uniform3fv(uniform('uLinkColor'), linkColors);
    gl.uniform1fv(uniform('uLinkPhase'), linkPhases);
    gl.uniform1fv(uniform('uLinkNear'), linkNear);
    gl.uniform1fv(uniform('uLinkClamp'), linkClamp);
    gl.uniform1fv(uniform('uLinkWeight'), linkWeight);

    const draw = () => {
      if (contextLost || canvas.width < 1 || canvas.height < 1) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(resolution, canvas.width, canvas.height);
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
        fallback.classList.add('opacity-0');
        if (!frame) frame = requestAnimationFrame(tick);
        return;
      }
      stop();
      if (reduceQuery.matches || contextLost) fallback.classList.remove('opacity-0');
      draw();
    }

    reduceQuery.addEventListener('change', onPreferenceChange);
    document.addEventListener('visibilitychange', onVisibility);
    observer.observe(canvas);
    sizeObserver.observe(canvas);
    resize();
    sync();
  });

  return (
    <div class="relative size-full">
      <canvas ref={canvas} class="absolute inset-0 size-full" aria-hidden="true" />
      <svg
        viewBox={`0 0 ${DESIGN_WIDTH} ${DESIGN_HEIGHT}`}
        class="absolute inset-0 size-full"
        role="img"
        aria-label={ARIA_LABEL}
      >
        <defs>
          <clipPath id="hero-tile-clip">
            <rect
              x={-TILE.half}
              y={-TILE.half}
              width={TILE.side}
              height={TILE.side}
              rx={TILE.radius}
            />
          </clipPath>
        </defs>
        <g
          ref={fallback}
          class="transition-opacity duration-500 ease-out-soft"
          opacity="0.25"
        >
          {LINKS.map((link) => (
            <line
              x1={link.x1}
              y1={link.y1}
              x2={link.x2}
              y2={link.y2}
              stroke={`var(${edgeHue(link)})`}
              stroke-width={(link.near ? LINK_STROKE.near : LINK_STROKE.far) * link.weight}
              opacity={link.near ? 0.7 : 0.3}
            />
          ))}
          {NODES.map((node) =>
            node.family ? null : (
              <circle
                cx={node.x}
                cy={node.y}
                r={node.r}
                fill="var(--color-base-100)"
                stroke={`var(${nodeHue(node)})`}
                stroke-width="0.05"
              />
            ),
          )}
        </g>
        {NODES.map((node) => {
          if (!node.family) return null;
          const identity = MODELS[node.family as ModelId];
          return (
            <g transform={`translate(${node.x} ${node.y})`} data-model={node.family} data-role={node.role}>
              <rect
                x={-TILE.half}
                y={-TILE.half}
                width={TILE.side}
                height={TILE.side}
                rx={TILE.radius}
                fill={identity.tileFill ?? 'var(--color-base-200)'}
              />
              <g clip-path="url(#hero-tile-clip)">
                {identity.logo ? (
                  <image
                    href={asset(identity.logo)}
                    x={-TILE.half}
                    y={-TILE.half}
                    width={TILE.side}
                    height={TILE.side}
                    preserveAspectRatio="xMidYMid meet"
                  />
                ) : (
                  <text
                    x="0"
                    y="0"
                    font-size="0.26"
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
                x={-TILE.half}
                y={-TILE.half}
                width={TILE.side}
                height={TILE.side}
                rx={TILE.radius}
                fill="none"
                stroke={identity.hue}
                stroke-width="0.04"
              />
              {node.label ? (
                <text
                  y={TILE.half + LABEL.gap}
                  fill="var(--color-dim)"
                  font-size={`${LABEL.size}`}
                  text-anchor="middle"
                >
                  {node.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
