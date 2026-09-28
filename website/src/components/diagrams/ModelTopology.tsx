import { For, onCleanup, onMount } from 'solid-js';
import { DECISION, REPAIR, WORKER_ALTERNATIVES, WORKER_NAMES } from '../../lib/pool';
import { topologyPoolBox, type PoolText, type TopologyVariant } from '../../lib/topology-layout';

/**
 * Model topology — how an Amaleh run's models work together.
 *
 * Server-rendered, complete and meaningful with no JavaScript: a static SVG
 * (a narrow stack below md, a wide instrument panel from md) whose labels are
 * real <text>. After mount a small script timeline walks one chunk through the
 * topology: delegate, consult, review, escalate, return — a packet rides the
 * active edge, the edge glows, and the matching step lights up in the legend.
 *
 * Motion rules (DESIGN-SYSTEM.md, Visualization layer): starts only after
 * mount, holds one static frame under prefers-reduced-motion and reacts to
 * that query's change event, pauses through IntersectionObserver off screen
 * and visibilitychange when the tab is hidden, and tears everything down in
 * onCleanup.
 */

const ARIA_LABEL =
  'Model topology of an Amaleh run: the coordinator host (Claude Code or Codex) ' +
  `hands a chunk to a routed Flash worker family — ${WORKER_ALTERNATIVES} — ` +
  `the worker asks ${DECISION.name} a bounded question, the other model family reviews ` +
  `read-only, a repair escalates to ${REPAIR.name}, and the accepted chunk returns to the coordinator.`;

const CAPTION =
  'One chunk, end to end: Claude Code or Codex hands a chunk to a routed Flash family — ' +
  `${WORKER_ALTERNATIVES} — ${DECISION.name} answers bounded choices, the other family reviews ` +
  `read-only, exhausted repairs escalate to ${REPAIR.name}, and the accepted chunk returns.`;

const poolTextClass = (text: PoolText): string => {
  if (text.kind === 'title') return 'fill-base-content font-semibold';
  if (text.kind === 'name') return 'fill-base-content font-mono';
  return 'fill-dim';
};

type Pt = readonly [number, number];

type Route = { readonly pts: readonly Pt[]; readonly cum: readonly number[]; readonly total: number };

const route = (...pts: Pt[]): Route => {
  const cum = [0];
  for (let i = 1; i < pts.length; i += 1) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    cum.push(cum[i - 1] + Math.hypot(bx - ax, by - ay));
  }
  return { pts, cum, total: cum[cum.length - 1] };
};

const pointOn = (r: Route, t: number): Pt => {
  const d = Math.min(Math.max(t, 0), 1) * r.total;
  let i = 1;
  while (i < r.cum.length - 1 && r.cum[i] < d) i += 1;
  const span = r.cum[i] - r.cum[i - 1];
  const f = span === 0 ? 0 : (d - r.cum[i - 1]) / span;
  const [ax, ay] = r.pts[i - 1];
  const [bx, by] = r.pts[i];
  return [ax + (bx - ax) * f, ay + (by - ay) * f];
};

/* Packet paths per stage, in viewBox units of the two SVG variants. */
const WIDE_ROUTES: Route[] = [
  route([200, 36], [120, 36], [120, 104]),
  route([100, 200], [100, 236]),
  route([230, 140], [286, 140]),
  route([170, 200], [170, 220], [270, 220], [270, 236]),
  route([370, 110], [370, 36], [346, 36]),
];

const NARROW_ROUTES: Route[] = [
  route([110, 46], [110, 64], [88, 64], [88, 76]),
  route([160, 110], [162, 110], [162, 162], [172, 162]),
  route([160, 96], [176, 96]),
  route([88, 164], [88, 176]),
  route([252, 80], [252, 28], [236, 28]),
];

/* Brass for the coordinator's chunk, violet for orchestration, teal for verified flow. */
const STAGE_COLORS = [
  'var(--color-primary)',
  'var(--color-accent)',
  'var(--color-secondary)',
  'var(--color-accent)',
  'var(--color-secondary)',
];

const MOVE_MS = 1600;
const HOLD_MS = 600;
const STAGE_MS = MOVE_MS + HOLD_MS;
const TOTAL_MS = STAGE_MS * STAGE_COLORS.length;

function PoolBox(props: { variant: TopologyVariant }) {
  const { box, texts } = topologyPoolBox(WORKER_NAMES, props.variant);
  return (
    <g>
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        rx={props.variant === 'narrow' ? 8 : 9}
        class="fill-base-100 stroke-line"
        stroke-width="1.5"
      />
      <For each={texts}>
        {(text) => (
          <text
            x={text.x}
            y={text.y}
            text-anchor={text.anchor}
            font-size={String(text.fontSize)}
            class={poolTextClass(text)}
          >
            {text.text}
          </text>
        )}
      </For>
    </g>
  );
}

export default function ModelTopology(props: { caption?: string; class?: string }) {
  let figure!: HTMLElement;

  onMount(() => {
    const svgs = Array.from(figure.querySelectorAll<SVGSVGElement>('[data-topo-svg]'));
    const units = svgs.map((svg) => ({
      packet: svg.querySelector<SVGGElement>('[data-topo-packet]'),
      glows: Array.from(svg.querySelectorAll<SVGGElement>('[data-topo-glow]')),
      steps: Array.from(svg.querySelectorAll<SVGTextElement>('[data-topo-step]')),
      routes: svg.dataset.topoVariant === 'narrow' ? NARROW_ROUTES : WIDE_ROUTES,
    }));

    const reducedMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;
    let running = false;
    let origin = 0;
    let stage = -1;
    let onScreen = false;

    const applyStage = (s: number) => {
      for (const u of units) {
        u.glows.forEach((g, i) => {
          g.style.opacity = i === s ? '1' : '0';
        });
        u.steps.forEach((t, i) => {
          t.style.fill = i === s ? STAGE_COLORS[s] : '';
        });
        if (u.packet) u.packet.style.color = STAGE_COLORS[s];
      }
    };

    const frame = (now: number) => {
      const t = (now - origin) % TOTAL_MS;
      const s = Math.floor(t / STAGE_MS);
      if (s !== stage) {
        stage = s;
        applyStage(s);
      }
      const p = t - s * STAGE_MS < MOVE_MS ? (t - s * STAGE_MS) / MOVE_MS : 1;
      for (const u of units) {
        if (!u.packet) continue;
        const [x, y] = pointOn(u.routes[s], p);
        u.packet.setAttribute('transform', `translate(${x} ${y})`);
      }
      raf = requestAnimationFrame(frame);
    };

    const startLoop = () => {
      if (running) return;
      running = true;
      origin = performance.now();
      stage = -1;
      for (const u of units) {
        if (u.packet) u.packet.style.opacity = '1';
      }
      raf = requestAnimationFrame(frame);
    };

    const stopLoop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
    };

    /* One static frame: every dynamic attribute returns to its server-rendered value. */
    const renderStatic = () => {
      stopLoop();
      for (const u of units) {
        for (const g of u.glows) g.style.opacity = '';
        for (const t of u.steps) t.style.fill = '';
        if (u.packet) {
          u.packet.style.opacity = '';
          u.packet.style.color = '';
        }
      }
    };

    const sync = () => {
      if (reducedMq.matches) {
        renderStatic();
        return;
      }
      if (!document.hidden && onScreen) startLoop();
      else stopLoop();
    };

    const onMotionPreferenceChange = () => sync();
    const onVisibilityChange = () => sync();
    const observer = new IntersectionObserver(
      (entries) => {
        onScreen = entries.some((entry) => entry.isIntersecting);
        sync();
      },
      { threshold: 0.1 },
    );
    observer.observe(figure);
    reducedMq.addEventListener('change', onMotionPreferenceChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    sync();

    onCleanup(() => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      reducedMq.removeEventListener('change', onMotionPreferenceChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    });
  });

  const figureClass = `overflow-hidden rounded-box border border-line bg-base-200 shadow-rest min-w-0${props.class ? ` ${props.class}` : ''}`;

  return (
    <figure ref={figure} class={figureClass}>
      <div class="aspect-[4/3] w-full sm:aspect-[16/10] lg:aspect-[16/9]">
        {/* Stacked form: phones and narrow columns, rendered at 4:3. */}
        <svg
          data-topo-svg
          data-topo-variant="narrow"
          class="h-full w-full md:hidden"
          viewBox="0 0 320 248"
          role="img"
          aria-label={ARIA_LABEL}
        >
          {/* Base edges with direction arrows. */}
          <g class="stroke-dim" stroke-width="1.5" fill="none" opacity="0.55">
            <path d="M110 46 V64 H88 V72" />
            <path d="M160 110 H162 V162 H172" />
            <path d="M160 96 H174" />
            <path d="M88 164 V176" />
            <path d="M252 80 V28 H236" />
          </g>
          <g class="fill-dim" opacity="0.55">
            <polygon points="82,72 94,72 88,80" />
            <polygon points="172,156 172,168 180,162" />
            <polygon points="174,90 174,102 180,96" />
            <polygon points="82,176 94,176 88,184" />
            <polygon points="236,22 236,34 230,28" />
          </g>
          <text x="246" y="56" text-anchor="end" font-size="8" class="fill-dim font-mono">accepted chunk</text>

          {/* Coordinator host. */}
          <rect x="90" y="10" width="140" height="36" rx="8" class="fill-base-100 stroke-primary" stroke-width="1.5" />
          <text x="160" y="26" text-anchor="middle" font-size="12" class="fill-base-content font-semibold">Coordinator</text>
          <text x="160" y="39" text-anchor="middle" font-size="9" class="fill-dim font-mono">Claude Code · Codex</text>

          {/* Flash worker pool: the routed families. */}
          <PoolBox variant="narrow" />

          {/* Reviewer family. */}
          <rect x="180" y="80" width="124" height="44" rx="8" class="fill-base-100 stroke-secondary" stroke-width="1.5" />
          <text x="188" y="97" font-size="11" class="fill-base-content font-semibold">Reviewer</text>
          <text x="188" y="113" font-size="9" class="fill-secondary font-mono">read-only</text>

          {/* Decision model, named from the pool. See website/src/lib/pool.ts */}
          <rect x="180" y="140" width="124" height="44" rx="8" class="fill-base-100 stroke-accent" stroke-width="1.5" />
          <text x="242" y="159" text-anchor="middle" font-size="11" class="fill-base-content font-semibold">{DECISION.name}</text>
          <text x="242" y="175" text-anchor="middle" font-size="9" class="fill-dim">bounded decisions</text>

          {/* Repair model, named from the pool. See website/src/lib/pool.ts */}
          <rect x="16" y="184" width="144" height="44" rx="8" class="fill-base-100 stroke-accent" stroke-width="1.5" />
          <text x="88" y="203" text-anchor="middle" font-size="11" class="fill-base-content font-semibold">{REPAIR.name}</text>
          <text x="88" y="219" text-anchor="middle" font-size="9" class="fill-dim">deeper specialist</text>

          {/* Script timeline, one lit step at a time. Sits in the empty band
              below every box: clear of every rect, never straddling an edge. */}
          <g font-size="9" class="font-mono">
            <text data-topo-step x="16" y="240" class="fill-dim">1 delegate</text>
            <text data-topo-step x="86" y="240" class="fill-dim">2 consult</text>
            <text data-topo-step x="148" y="240" class="fill-dim">3 review</text>
            <text data-topo-step x="204" y="240" class="fill-dim">4 escalate</text>
            <text data-topo-step x="266" y="240" class="fill-dim">5 return</text>
          </g>

          {/* Active-stage overlays, lit one at a time by the script. */}
          <g data-topo-glow opacity="0">
            <path d="M110 46 V64 H88 V72" class="stroke-primary fill-none" stroke-width="2.5" />
            <polygon points="82,72 94,72 88,80" class="fill-primary" />
          </g>
          <g data-topo-glow opacity="0">
            <path d="M160 110 H162 V162 H172" class="stroke-accent fill-none" stroke-width="2.5" />
            <polygon points="172,156 172,168 180,162" class="fill-accent" />
          </g>
          <g data-topo-glow opacity="0">
            <path d="M160 96 H174" class="stroke-secondary fill-none" stroke-width="2.5" />
            <polygon points="174,90 174,102 180,96" class="fill-secondary" />
          </g>
          <g data-topo-glow opacity="0">
            <path d="M88 164 V176" class="stroke-accent fill-none" stroke-width="2.5" />
            <polygon points="82,176 94,176 88,184" class="fill-accent" />
          </g>
          <g data-topo-glow opacity="0">
            <path d="M252 80 V28 H236" class="stroke-secondary fill-none" stroke-width="2.5" />
            <polygon points="236,22 236,34 230,28" class="fill-secondary" />
          </g>

          <g data-topo-packet transform="translate(-40 -40)" opacity="0" class="text-primary">
            <circle r="5" fill="currentColor" opacity="0.25" />
            <circle r="2.5" fill="currentColor" />
          </g>
        </svg>

        {/* Wide form: the instrument panel, from md upward. */}
        <svg
          data-topo-svg
          data-topo-variant="wide"
          class="hidden h-full w-full md:block"
          viewBox="0 0 520 304"
          role="img"
          aria-label={ARIA_LABEL}
        >
          {/* Base edges with direction arrows. */}
          <g class="stroke-dim" stroke-width="1.5" fill="none" opacity="0.55">
            <path d="M200 36 H120 V102" />
            <path d="M100 200 V232" />
            <path d="M230 140 H284" />
            <path d="M170 200 V220 H270 V232" />
            <path d="M370 110 V36 H346" />
          </g>
          <g class="fill-dim" opacity="0.55">
            <polygon points="114,102 126,102 120,110" />
            <polygon points="94,232 106,232 100,240" />
            <polygon points="284,134 284,146 290,140" />
            <polygon points="264,232 276,232 270,240" />
            <polygon points="346,30 346,42 340,36" />
          </g>
          <g font-size="8" class="font-mono fill-dim">
            <text x="160" y="30" text-anchor="middle">chunk</text>
            <text x="108" y="222">question</text>
            <text x="260" y="134" text-anchor="middle">review</text>
            <text x="220" y="214" text-anchor="middle">escalate</text>
            <text x="378" y="76" text-anchor="start">accepted chunk</text>
          </g>

          {/* Coordinator host. */}
          <rect x="200" y="16" width="140" height="40" rx="9" class="fill-base-100 stroke-primary" stroke-width="1.5" />
          <text x="270" y="34" text-anchor="middle" font-size="12" class="fill-base-content font-semibold">Coordinator</text>
          <text x="270" y="48" text-anchor="middle" font-size="9" class="fill-dim font-mono">Claude Code · Codex</text>

          {/* Flash worker pool: the routed families. */}
          <PoolBox variant="wide" />

          {/* Reviewer family: always the other model family. */}
          <rect x="290" y="110" width="180" height="90" rx="9" class="fill-base-100 stroke-secondary" stroke-width="1.5" />
          <text x="300" y="128" font-size="10" class="fill-base-content font-semibold">Reviewer family</text>
          <text x="300" y="144" font-size="9" class="fill-secondary font-mono">read-only</text>
          <text x="300" y="162" font-size="9" class="fill-dim">the other Flash family reads</text>
          <text x="300" y="176" font-size="9" class="fill-dim">each chunk, verifies coverage</text>
          <text x="300" y="192" font-size="9" class="fill-dim">findings feed the repair loop</text>

          {/* Decision model, named from the pool. See website/src/lib/pool.ts */}
          <rect x="50" y="240" width="120" height="44" rx="9" class="fill-base-100 stroke-accent" stroke-width="1.5" />
          <text x="110" y="259" text-anchor="middle" font-size="11" class="fill-base-content font-semibold">{DECISION.name}</text>
          <text x="110" y="275" text-anchor="middle" font-size="9" class="fill-dim">bounded decisions</text>

          {/* Repair model, named from the pool. See website/src/lib/pool.ts */}
          <rect x="210" y="240" width="120" height="44" rx="9" class="fill-base-100 stroke-accent" stroke-width="1.5" />
          <text x="270" y="259" text-anchor="middle" font-size="11" class="fill-base-content font-semibold">{REPAIR.name}</text>
          <text x="270" y="275" text-anchor="middle" font-size="9" class="fill-dim">deeper specialist</text>

          {/* Escalation boundary note. */}
          <text x="360" y="242" font-size="9" class="fill-dim">only genuine boundaries</text>
          <text x="360" y="256" font-size="9" class="fill-dim">reach the coordinator:</text>
          <text x="360" y="270" font-size="9" class="fill-dim">exhausted repairs, missing</text>
          <text x="360" y="284" font-size="9" class="fill-dim">evidence, unclear intent</text>

          {/* Script timeline, one lit step at a time. */}
          <g font-size="9" class="font-mono">
            <text data-topo-step x="50" y="298" class="fill-dim">1 delegate</text>
            <text data-topo-step x="130" y="298" class="fill-dim">2 consult</text>
            <text data-topo-step x="210" y="298" class="fill-dim">3 review</text>
            <text data-topo-step x="290" y="298" class="fill-dim">4 escalate</text>
            <text data-topo-step x="390" y="298" class="fill-dim">5 return</text>
          </g>

          {/* Active-stage overlays, lit one at a time by the script. */}
          <g data-topo-glow opacity="0">
            <path d="M200 36 H120 V102" class="stroke-primary fill-none" stroke-width="2.5" />
            <polygon points="114,102 126,102 120,110" class="fill-primary" />
          </g>
          <g data-topo-glow opacity="0">
            <path d="M100 200 V232" class="stroke-accent fill-none" stroke-width="2.5" />
            <polygon points="94,232 106,232 100,240" class="fill-accent" />
          </g>
          <g data-topo-glow opacity="0">
            <path d="M230 140 H284" class="stroke-secondary fill-none" stroke-width="2.5" />
            <polygon points="284,134 284,146 290,140" class="fill-secondary" />
          </g>
          <g data-topo-glow opacity="0">
            <path d="M170 200 V220 H270 V232" class="stroke-accent fill-none" stroke-width="2.5" />
            <polygon points="264,232 276,232 270,240" class="fill-accent" />
          </g>
          <g data-topo-glow opacity="0">
            <path d="M370 110 V36 H346" class="stroke-secondary fill-none" stroke-width="2.5" />
            <polygon points="346,30 346,42 340,36" class="fill-secondary" />
          </g>

          <g data-topo-packet transform="translate(-40 -40)" opacity="0" class="text-primary">
            <circle r="6" fill="currentColor" opacity="0.25" />
            <circle r="2.75" fill="currentColor" />
          </g>
        </svg>
      </div>
      <figcaption class="border-t border-line px-4 py-3 text-sm text-dim">{props.caption ?? CAPTION}</figcaption>
    </figure>
  );
}