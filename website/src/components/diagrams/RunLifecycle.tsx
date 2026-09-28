import { onCleanup, onMount, type JSX } from 'solid-js';
import { WORKERS } from '../../lib/pool';

/**
 * Run lifecycle — the subject of the workflow page: discovery through
 * planning, delegation, parallel execution and verified delivery.
 *
 * Static SVG first (stacked variant below `sm`, wide variant above), real
 * `<text>` labels throughout, `role="img"` with an aria-label. The timeline
 * starts after mount: connector dashes march and a highlight walks the run.
 * Reduced motion holds one static frame and follows the query's `change`
 * event; an IntersectionObserver and a visibilitychange listener pause the
 * loop off screen and in hidden tabs; `onCleanup` releases it all.
 */

type Tone = 'primary' | 'secondary' | 'accent' | 'info' | 'dim';

const ringStroke: Record<Tone, string> = {
  primary: 'stroke-primary',
  secondary: 'stroke-secondary',
  accent: 'stroke-accent',
  info: 'stroke-info',
  dim: 'stroke-dim',
};

const fillTone: Record<Tone, string> = {
  primary: 'fill-primary',
  secondary: 'fill-secondary',
  accent: 'fill-accent',
  info: 'fill-info',
  dim: 'fill-dim',
};

function Box(props: {
  x: number;
  y: number;
  w: number;
  h: number;
  step?: number;
  tone?: Tone;
  children?: JSX.Element;
}) {
  return (
    <g>
      <rect
        x={props.x}
        y={props.y}
        width={props.w}
        height={props.h}
        rx="10"
        class="fill-base-300 stroke-line"
        stroke-width="1"
      />
      {props.step !== undefined && (
        <rect
          x={props.x}
          y={props.y}
          width={props.w}
          height={props.h}
          rx="10"
          class={`fill-none ${ringStroke[props.tone ?? 'primary']}`}
          stroke-width="2"
          data-pulse={props.step}
          opacity={props.step === 0 ? '0.9' : '0'}
        />
      )}
      {props.children}
    </g>
  );
}

function Flow(props: { d: string; tone?: Tone }) {
  return (
    <path
      d={props.d}
      class={`fill-none ${ringStroke[props.tone ?? 'primary']}`}
      stroke-width="1.5"
      stroke-dasharray="6 6"
      data-flow=""
    />
  );
}

function Head(props: { points: string; tone?: Tone }) {
  return <polygon points={props.points} class={fillTone[props.tone ?? 'primary']} />;
}

function T(props: {
  x: number;
  y: number;
  s: number;
  f?: string;
  mono?: boolean;
  b?: boolean;
  mid?: boolean;
  children: string;
}) {
  return (
    <text
      x={props.x}
      y={props.y}
      font-size={String(props.s)}
      text-anchor={props.mid ? 'middle' : undefined}
      class={`${props.mono ? 'font-mono ' : ''}${props.b ? 'font-semibold ' : ''}${props.f ?? 'fill-dim'}`}
    >
      {props.children}
    </text>
  );
}

export default function RunLifecycle() {
  let panel!: HTMLDivElement;

  onMount(() => {
    const flows = Array.from(panel.querySelectorAll<SVGGeometryElement>('[data-flow]'));
    const pulses = Array.from(panel.querySelectorAll<SVGElement>('[data-pulse]'));
    const steps = pulses.map((el) => Number(el.getAttribute('data-pulse')));
    const stepCount = Math.max(...steps) + 1;
    const offsets = Array.from({ length: 12 }, (_, i) => String(-i));
    const STEP_SECONDS = 0.9;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');

    let raf = 0;
    let origin = 0;
    let onScreen = true;

    const renderStatic = () => {
      for (const el of flows) el.setAttribute('stroke-dashoffset', '0');
      for (let i = 0; i < pulses.length; i += 1) {
        pulses[i].setAttribute('opacity', steps[i] === 0 ? '0.9' : '0');
      }
    };

    const stop = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const tick = (now: number) => {
      const t = (now - origin) / 1000;
      const offset = offsets[Math.floor((t * 24) % 12)];
      for (const el of flows) el.setAttribute('stroke-dashoffset', offset);
      const step = Math.floor(t / STEP_SECONDS) % stepCount;
      for (let i = 0; i < pulses.length; i += 1) {
        pulses[i].setAttribute('opacity', steps[i] === step ? '0.9' : '0');
      }
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (raf || media.matches || !onScreen || document.hidden) return;
      origin = performance.now();
      raf = requestAnimationFrame(tick);
    };

    const applyMotion = () => {
      if (media.matches) {
        stop();
        renderStatic();
      } else {
        start();
      }
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    const observer = new IntersectionObserver(
      (entries) => {
        onScreen = entries[0]?.isIntersecting ?? true;
        if (onScreen) start();
        else stop();
      },
      { threshold: 0.05 },
    );

    observer.observe(panel);
    media.addEventListener('change', applyMotion);
    document.addEventListener('visibilitychange', onVisibility);

    if (media.matches) renderStatic();
    else start();

    onCleanup(() => {
      stop();
      observer.disconnect();
      media.removeEventListener('change', applyMotion);
      document.removeEventListener('visibilitychange', onVisibility);
    });
  });

  return (
    <figure class="overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
      <div ref={panel} class="aspect-[4/3] w-full sm:aspect-[16/10] lg:aspect-[16/9]">
        <svg
          viewBox="0 0 288 216"
          role="img"
          aria-label="Run lifecycle: discovery, planning, delegation, parallel worker execution, checks and review, verified delivery"
          class="size-full sm:hidden"
          preserveAspectRatio="xMidYMid meet"
        >
          <Box x={8} y={6} w={272} h={22} step={0} tone="primary">
            <T x={144} y={21} s={11} f="fill-base-content" b mid>coordinator</T>
          </Box>
          <Box x={8} y={36} w={272} h={22} step={1} tone="primary">
            <T x={144} y={51} s={11} f="fill-base-content" b mid>discovery</T>
          </Box>
          <Box x={8} y={66} w={272} h={22} step={2} tone="primary">
            <T x={144} y={81} s={11} f="fill-base-content" b mid>planning</T>
          </Box>
          <Box x={8} y={96} w={272} h={22} step={3} tone="primary">
            <T x={144} y={111} s={11} f="fill-base-content" b mid>delegation</T>
          </Box>
          <Box x={8} y={126} w={272} h={22} step={4} tone="primary">
            <T x={144} y={141} s={11} f="fill-base-content" b mid>workers · isolated workspaces</T>
          </Box>
          <Box x={8} y={156} w={272} h={22} step={5} tone="secondary">
            <T x={144} y={171} s={11} f="fill-secondary" b mid>checks + cross-family review</T>
          </Box>
          <Box x={8} y={186} w={272} h={22} step={6} tone="secondary">
            <T x={144} y={201} s={11} f="fill-secondary" b mid>verified delivery</T>
          </Box>

          <Flow d="M 144 29 V 31" />
          <Head points="144,36 140,30 148,30" />
          <Flow d="M 144 59 V 61" />
          <Head points="144,66 140,60 148,60" />
          <Flow d="M 144 89 V 91" />
          <Head points="144,96 140,90 148,90" />
          <Flow d="M 144 119 V 121" />
          <Head points="144,126 140,120 148,120" />
          <Flow d="M 144 149 V 151" />
          <Head points="144,156 140,150 148,150" />
          <Flow d="M 144 179 V 181" tone="secondary" />
          <Head points="144,186 140,180 148,180" tone="secondary" />
        </svg>

        <svg
          viewBox="0 0 800 450"
          role="img"
          aria-label="Run lifecycle: the coordinator discovers and plans, delegates chunks, workers run in parallel through checks and cross-family review, and verified work is delivered"
          class="hidden size-full sm:block"
          preserveAspectRatio="xMidYMid meet"
        >
          <Box x={18} y={36} w={160} h={76} step={0} tone="primary">
            <T x={32} y={82} s={15} f="fill-base-content" b>coordinator</T>
            <T x={32} y={102} s={10.5}>the invoking host</T>
          </Box>
          <Box x={206} y={36} w={150} h={76} step={1} tone="primary">
            <T x={220} y={82} s={14.5} f="fill-base-content" b>discovery</T>
            <T x={220} y={102} s={10.5}>decisions recorded</T>
          </Box>
          <Box x={382} y={36} w={150} h={76} step={2} tone="primary">
            <T x={396} y={82} s={14.5} f="fill-base-content" b>planning</T>
            <T x={396} y={102} s={10}>one deliverable per task</T>
          </Box>
          <Box x={560} y={36} w={222} h={76} step={3} tone="primary">
            <T x={574} y={82} s={14.5} f="fill-base-content" b>delegation</T>
            <T x={574} y={102} s={10} mono>delegate · delegate-batch</T>
          </Box>

          <Box x={186} y={224} w={200} h={144} step={4} tone="primary">
            <T x={200} y={270} s={12.5} f="fill-base-content" b>parallel execution</T>
            <T x={200} y={294} s={10} mono>{`worker · ${WORKERS[1].name} family`}</T>
            <T x={200} y={314} s={10} mono>{`worker · ${WORKERS[0].name} family`}</T>
            <T x={200} y={334} s={10} mono>worker · routed family</T>
            <T x={200} y={354} s={9.5}>isolated workspace per chunk</T>
          </Box>

          <Box x={470} y={224} w={290} h={144} step={5} tone="secondary">
            <T x={484} y={254} s={13.5} f="fill-secondary" b>checks + review</T>
            <T x={484} y={280} s={10.5}>registered checks · receipts saved</T>
            <T x={484} y={298} s={10.5}>independent reviewer · other model family</T>
            <T x={484} y={316} s={10.5}>fresh read-only context · no author verdict</T>
            <T x={484} y={334} s={10.5}>coverage entry per obligation id</T>
          </Box>

          <Box x={470} y={400} w={290} h={46} step={6} tone="secondary">
            <T x={484} y={427} s={13.5} f="fill-secondary" b>verified delivery</T>
            <T x={580} y={441} s={9} mid>accept · integrate · finish</T>
          </Box>

          <Flow d="M 178 74 H 200" />
          <Head points="206,74 198,70 198,78" />
          <Flow d="M 356 74 H 376" />
          <Head points="382,74 374,70 374,78" />
          <Flow d="M 532 74 H 554" />
          <Head points="560,74 552,70 552,78" />
          <Flow d="M 671 112 V 186 H 286 V 218" />
          <Head points="286,224 282,216 290,216" />
          <Flow d="M 386 296 H 464" tone="secondary" />
          <Head points="470,296 462,292 462,300" tone="secondary" />
          <Flow d="M 615 368 V 394" tone="secondary" />
          <Head points="615,400 611,392 619,392" tone="secondary" />
          <Flow d="M 470 422 H 98 V 118" tone="accent" />
          <Head points="98,112 94,120 102,120" tone="accent" />
          <T x={270} y={414} s={10.5} mid>next — newly unlocked tasks</T>
        </svg>
      </div>
      <figcaption class="border-t border-line px-4 py-3 text-sm text-dim">
        One run: discovery and planning settle what to build, the coordinator delegates each chunk
        to an isolated workspace, workers run in parallel through checks and cross-family review,
        and only verified work is integrated before <span class="font-mono">next</span> unlocks
        dependents.
      </figcaption>
    </figure>
  );
}