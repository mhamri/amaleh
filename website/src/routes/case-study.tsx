import { For } from 'solid-js';
import PageMeta from '../components/PageMeta';
import { asset } from '../lib/paths';
import { CASE_STUDY_PATH, articleGraph } from '../lib/seo';
import { Blobs, Glow, GridDots, LightRays } from '../components/decor';
import JevAsciiMark from '../components/case-study/JevAsciiMark';

const title = 'Case study — Amaleh';
const description =
  'How Amaleh built this site: every claim the landing page makes, proven with measured figures from the run records that built it.';
const crumb = { name: 'Case study', path: CASE_STUDY_PATH };
const graph = articleGraph({ crumb, headline: title, description });

const claims = [
  {
    claim: 'Cheap Flash models do the actual work.',
    proof: '156 model calls across two runs, most from DeepSeek, GLM, Solar and MiMo Flash models. Workers cost an estimated 4.47 US dollars over 57 calls in website-polish alone.',
    chip: '156 calls',
    chipHue: 'badge-primary',
  },
  {
    claim: 'Another model family reviews every chunk.',
    proof: '74 independent reviews, each from a different model family than the author. The reviewer never sees the author\'s proposed verdict.',
    chip: '74 reviews',
    chipHue: 'badge-secondary',
  },
  {
    claim: 'Defects are caught before merge.',
    proof: '45 blocking review findings, every one repaired inside the chunk before it was accepted. A sixth of the total reviews found something worth blocking.',
    chip: '45 blocking',
    chipHue: 'badge-accent',
  },
  {
    claim: 'The run resumes from disk.',
    proof: '270 check runs across both runs. Durable checkpoints mean an interrupted session picks up exactly where it stopped, with no work lost.',
    chip: '270 checks',
    chipHue: 'badge-secondary',
  },
  {
    claim: 'It costs little.',
    proof: 'Estimated worker and reviewer spend: 7.82 US dollars for two full runs that built, reviewed and shipped a seven-route website. Cost is pi\'s local estimate, not a billed figure, and the coordinating host model is not in it.',
    chip: '~7.82 USD',
    chipHue: 'badge-warning',
  },
];

const defects = [
  {
    before: 'Hero with reduced motion showed a permanently blank canvas for visitors who prefer stillness, because the accessible fallback was hidden while the canvas drew nothing.',
    after: 'The fallback now stays visible alongside the canvas. A reviewer from a different model family caught this before the chunk merged.',
  },
  {
    before: 'The coordinator, worker and reviewer nodes vanished almost immediately in the live animation in every WebGL browser, leaving the hero empty.',
    after: 'Node timing was fixed so the workflow it exists to show stays visible throughout. A reviewer flagged this as a blocking finding.',
  },
  {
    before: 'At desktop widths the "On this page" list appeared twice on every documentation page, and at 320, 390 and 768 CSS pixels it was missing entirely.',
    after: 'The list now renders exactly once at every width, in its own right rail from xl and inline below. The static checker was not catching this; a browser review did.',
  },
  {
    before: 'Three source files carried the wrong pronunciation and the static checker asserted the wrong value, so fixing the sources would have broken the checker.',
    after: 'Both the sources and the checker were corrected in the same chunk. A reviewer found the mismatch between what the page said and what the checker checked.',
  },
  {
    before: 'At 320 CSS pixels the Credentials chip overran its card and the whole landing page scrolled sideways.',
    after: 'The chip wraps properly at phone width. The layout probe at 320 pixels now passes.',
  },
  {
    before: 'The new two-column limit for prose cards was written into the design system but the checker never ran it, so continuous integration would have passed a page that broke the rule.',
    after: 'The prose-grid-columns gate was added to the static checker. The rule now blocks any prose card grid declaring more than two columns.',
  },
];

const jevDecisions = [
  'Workers asked Jev for an in-task decision 27 times without the coordinator: 3 in website-visuals, 24 in website-polish.',
  'Jev selects proceed, research, focused grilling or brainstorming from an actual gap. No coordinator needed.',
  'Models that did the work: DeepSeek, GLM, Solar, MiMo. Kimi handled escalated repairs.',
];

const limits = [
  {
    title: 'Host exceptions',
    body: 'The coordinator took over implementation where the cheap-model loop could not finish: 9 host exceptions in website-polish and 1 in website-visuals. Each is recorded with its reason.',
  },
  {
    title: 'Health warnings',
    body: 'website-polish closed with 3 delegation-health warnings acknowledged: the coordinator made 35 worker, reviewer, repair and accept calls by hand; 23 invalidations reopened delivered chunks because their own checks could not see the defect; and Kimi took 35% of the estimated spend.',
  },
  {
    title: 'Kimi share',
    body: 'Kimi, the deeper repair model, took the largest single share of website-polish spend: an estimated 2.38 of 6.78 US dollars. That is a cost of escalation, not the baseline.',
  },
];

const skillRuntime = [
  ['Bun', '1.4.2'],
  ['Node.js latest stable', '26.9.0'],
  ['pi coding agent', '0.85.1'],
  ['Jev OpenRouter model', 'typesafe/jev-1.13'],
];

export default function CaseStudyPage() {
  return (
    <>
      <PageMeta path={CASE_STUDY_PATH} title={title} description={description} structuredData={graph} />
      <main id="main">
        <section class="relative isolate min-h-[30rem] overflow-hidden pb-4 pt-32 md:pb-8 md:pt-32">
          <div
            class="decor-field"
            aria-hidden="true"
            style={{
              'mask-image': 'linear-gradient(to bottom, transparent 0%, black 12%, black 82%, transparent 100%)',
              '-webkit-mask-image': 'linear-gradient(to bottom, transparent 0%, black 12%, black 82%, transparent 100%)',
            }}
          >
            <div
              class="absolute inset-0"
              style={{
                'mask-image': 'linear-gradient(to right, transparent 0%, black 6%, black 94%, transparent 100%)',
                '-webkit-mask-image': 'linear-gradient(to right, transparent 0%, black 6%, black 94%, transparent 100%)',
              }}
            >
              <LightRays hue="primary" apexXFraction={0.5} apexYFraction={-0.12} spreadDegrees={180} opacity={0.4} />
              <Glow hue="primary" diameterPx={1500} centreXFraction={0.44} centreYFraction={0.4} opacity={0.32} />
              <Blobs hue="primary" diameterPx={1000} centreXFraction={0.9} centreYFraction={0.35} blurPx={80} opacity={0.55} />
              <Blobs hue="accent" diameterPx={900} centreXFraction={0.15} centreYFraction={1.08} blurPx={85} opacity={0.5} />
              <GridDots hue="secondary" spacingPx={28} centreXFraction={0.85} centreYFraction={0.1} opacity={0.25} />
            </div>
          </div>
          <div class="mx-auto w-full max-w-7xl px-4 sm:px-6">
            <h1 class="font-display text-hero font-semibold tracking-tight">
              How Amaleh built this site
            </h1>
            <p class="mt-5 text-lg leading-relaxed text-dim max-w-prose" data-reveal>
              Every claim the landing page makes about the skill is backed by a measured figure
              from the two runs that built this website. Nothing here is a benchmark. These are
              local estimates from the records that exist.
            </p>
            <p class="mt-4 text-base leading-relaxed text-dim max-w-prose">
              The project's name is <span lang="fa" dir="rtl">عمله</span>, transliterated as{' '}
              <em>ʿamalah</em> and pronounced <strong class="text-base-content">Ah-mah-leh</strong>
              . It is a Persian word meaning <strong>workers / laborers</strong> — people
              contributing effort to a shared result. <em>Amaleh</em> is the project's Latin-script
              name.
            </p>
          </div>
        </section>

        <section class="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 md:pt-8" data-reveal>
          <h2 class="font-display text-display font-semibold tracking-tight">
            The two runs
          </h2>
          <p class="mt-4 text-base leading-relaxed text-dim max-w-prose">
            Two runs built and shipped this website: <span class="text-base-content">website-visuals</span> (6
            tasks) and <span class="text-base-content">website-polish</span> (11 tasks). The table
            sums both.
          </p>
          <div class="mt-6 overflow-x-auto rounded-box border border-line bg-base-200 shadow-rest">
            <table class="table table-sm">
              <thead class="font-mono text-xs text-dim">
                <tr>
                  <th>Run</th>
                  <th>Tasks</th>
                  <th>Model calls</th>
                  <th>Reviews</th>
                  <th>Blocking findings</th>
                  <th>Check runs</th>
                  <th>Cost estimate</th>
                </tr>
              </thead>
              <tbody class="text-sm">
                <tr>
                  <td>website-visuals</td>
                  <td>6</td>
                  <td>32</td>
                  <td>18</td>
                  <td>11</td>
                  <td>61</td>
                  <td>1.04 USD</td>
                </tr>
                <tr>
                  <td>website-polish</td>
                  <td>11</td>
                  <td>124</td>
                  <td>56</td>
                  <td>34</td>
                  <td>209</td>
                  <td>6.78 USD</td>
                </tr>
                <tr class="font-medium">
                  <td>Both runs</td>
                  <td>17</td>
                  <td>156</td>
                  <td>74</td>
                  <td>45</td>
                  <td>270</td>
                  <td>~7.82 USD</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="mt-3 text-sm text-dim max-w-prose">
            Cost is pi's local estimate of the worker and reviewer calls, not a billed figure; the
            coordinating host model is not in it. A blocking finding is a defect an
            independent reviewer from a different model family refused to accept.
          </p>
        </section>

        <section class="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 md:py-24" data-reveal>
          <div class="decor-field" aria-hidden="true">
            <Glow hue="secondary" diameterPx={720} centreXFraction={0.8} centreYFraction={0.3} opacity={0.25} />
            <GridDots hue="primary" spacingPx={32} centreXFraction={0.2} centreYFraction={0.8} opacity={0.3} />
          </div>
          <h2 class="font-display text-display font-semibold tracking-tight">
            The skill's own output
          </h2>
          <p class="mt-4 text-base leading-relaxed text-dim max-w-prose">
            These are real terminal screenshots of the skill reporting on the website-polish run.
            The first shows the readable status report. The second shows delegation health, model
            speed per role and estimated spend by model.
          </p>
          <div class="mt-8 grid gap-8 md:grid-cols-2 md:gap-x-8 md:gap-y-0">
            <figure class="md:grid md:row-span-3 md:grid-rows-subgrid overflow-hidden rounded-box border border-line bg-base-200 shadow-raised shadow-rest-glow-primary" data-reveal>
              <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
                <span>status for website-polish</span>
                <span class="badge badge-soft badge-primary font-sans text-xs">terminal output</span>
              </div>
              <div class="bg-[#0d1117]">
                <img
                  src={asset('case-study/status-report.png')}
                  alt="Terminal output showing the status report for the website-polish run: tasks, statuses, check receipts and completion summary."
                  class="w-full"
                  style={{'clip-path': 'inset(0 0 3px 0)'}}
                  loading="lazy"
                />
              </div>
              <figcaption class="px-4 py-3 text-sm text-dim border-t border-line">
                Status report for website-polish: tasks, their statuses, registered check receipts
                and the completion summary.
              </figcaption>
            </figure>
            <figure class="md:grid md:row-span-3 md:grid-rows-subgrid overflow-hidden rounded-box border border-line bg-base-200 shadow-raised shadow-rest-glow-secondary" data-reveal>
              <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
                <span>health for website-polish</span>
                <span class="badge badge-soft badge-secondary font-sans text-xs">terminal output</span>
              </div>
              <div class="bg-[#0d1117]">
                <img
                  src={asset('case-study/health-report.png')}
                  alt="Terminal output showing delegation health for website-polish: worker versus reviewer versus manual dispatch counts, model speed per role, and estimated spend per model."
                  class="w-full"
                  style={{'clip-path': 'inset(0 0 3px 0)'}}
                  loading="lazy"
                />
              </div>
              <figcaption class="px-4 py-3 text-sm text-dim border-t border-line">
                Delegation health for website-polish: worker versus reviewer versus manual
                dispatch counts, model speed per role, and estimated spend by model.
              </figcaption>
            </figure>
          </div>
        </section>

        <section class="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 md:py-24" data-reveal>
          <div class="decor-field" aria-hidden="true">
            <Glow hue="accent" diameterPx={560} centreXFraction={0.9} centreYFraction={0.5} opacity={0.2} />
          </div>
          <h2 class="font-display text-display font-semibold tracking-tight">
            Claim and proof
          </h2>
          <p class="mt-4 text-base leading-relaxed text-dim max-w-prose">
            Each claim the landing page makes about Amaleh, paired with the measured figure
            that backs it.
          </p>
          <div class="mt-8 grid gap-6 md:grid-cols-2">
            <For each={claims}>
              {(item) => (
                <article class="card rounded-box border border-line bg-base-200 shadow-rest" data-reveal>
                  <div class="card-body gap-3 p-6">
                    <div class="flex items-start justify-between gap-3">
                      <p class="text-sm font-medium text-base-content leading-relaxed">{item.claim}</p>
                      <span class={`badge badge-soft ${item.chipHue} text-xs shrink-0`}>{item.chip}</span>
                    </div>
                    <p class="text-sm leading-relaxed text-dim">{item.proof}</p>
                  </div>
                </article>
              )}
            </For>
          </div>
        </section>

        <section class="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 md:py-24">
          <h2 class="font-display text-display font-semibold tracking-tight">
            Defects independent review caught before merge
          </h2>
          <p class="mt-4 text-base leading-relaxed text-dim max-w-prose">
            Every one of these was blocking: a reviewer from a different model family refused to
            accept the chunk until the fix was in. All six were repaired inside the chunk.
          </p>
          <div class="mt-8 grid gap-6 md:grid-cols-2">
            <For each={defects}>
              {(item) => (
                <article class="card rounded-box border border-line bg-base-200 shadow-rest" data-reveal>
                  <div class="card-body gap-3 p-6">
                    <div class="flex items-start gap-3">
                      <span class="badge badge-soft badge-warning text-xs shrink-0">before</span>
                      <p class="text-sm leading-relaxed text-dim">{item.before}</p>
                    </div>
                    <div class="flex items-start gap-3">
                      <span class="badge badge-soft badge-secondary text-xs shrink-0">after</span>
                      <p class="text-sm leading-relaxed text-dim">{item.after}</p>
                    </div>
                  </div>
                </article>
              )}
            </For>
          </div>
        </section>

        <section class="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 md:py-24" data-reveal>
          <div class="grid items-start gap-10 lg:grid-cols-[minmax(0,32rem)_minmax(0,1fr)] lg:gap-14">
            <div>
              <h2 class="font-display text-display font-semibold tracking-tight">
                In-task decisions
              </h2>
              <p class="mt-4 text-base leading-relaxed text-dim max-w-prose">
                Workers consulted Jev directly for bounded either-or questions without
                escalating to the coordinator. 27 times across both runs.
              </p>
              <ul class="mt-6 space-y-3 max-w-prose">
                <For each={jevDecisions}>
                  {(item) => (
                    <li class="flex items-start gap-3 text-sm leading-relaxed text-dim">
                      <span class="badge badge-soft badge-accent text-xs shrink-0 mt-0.5">Jev</span>
                      <span>{item}</span>
                    </li>
                  )}
                </For>
              </ul>
            </div>
            <div>
              <JevAsciiMark />
            </div>
          </div>
        </section>

        <section class="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 md:py-24" data-reveal>
          <h2 class="font-display text-display font-semibold tracking-tight">
            What the runtime learned
          </h2>
          <p class="mt-4 text-base leading-relaxed text-dim max-w-prose">
            The same run records that show the numbers also show where the cheap-model loop
            needed help. These are not failures; they are the reasons the runtime now refuses to
            finish a run while any warning stands.
          </p>
          <div class="mt-8 grid gap-6 md:grid-cols-2">
            <For each={limits}>
              {(item) => (
                <article class="card rounded-box border border-line bg-base-200 shadow-rest" data-reveal>
                  <div class="card-body gap-3 p-6">
                    <h3 class="font-display text-title font-semibold tracking-tight">{item.title}</h3>
                    <p class="text-sm leading-relaxed text-dim">{item.body}</p>
                  </div>
                </article>
              )}
            </For>
          </div>
        </section>

        <section class="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 md:py-24" data-reveal>
          <h2 class="font-display text-display font-semibold tracking-tight">
            How the skill is tested
          </h2>
          <div class="mt-6 grid items-start gap-10 lg:grid-cols-[minmax(0,32rem)_minmax(0,1fr)] lg:gap-14">
            <div class="min-w-0 text-base leading-relaxed text-dim max-w-prose space-y-4">
              <p>
                The skill is tested two ways. A live delegated fixture runs a billing
                scenario through the real OpenRouter credential: Jev routing, Flash
                implementation, an independent other-family read-only review, exact amount
                tests, and acceptance, integration, completion. No separate TypeSafe key
                is required.
              </p>
              <p>
                An offline behavioral suite runs without any model. It covers routing,
                lifecycle recovery, parallel ownership, review coverage, context isolation
                and startup preflight. The latest development check: 83 Bun tests and 95
                Node tests passed.
              </p>
            </div>
            <div class="min-w-0 overflow-x-auto rounded-box border border-line bg-base-200 shadow-rest">
              <table class="table table-sm">
                <thead class="font-mono text-xs text-dim">
                  <tr>
                    <th>Skill runtime source</th>
                    <th>Verified version</th>
                  </tr>
                </thead>
                <tbody class="text-sm">
                  <For each={skillRuntime}>
                    {([name, version]) => (
                      <tr>
                        <td>{name}</td>
                        <td class="font-mono">{version}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </div>
          <p class="mt-6 text-sm text-dim max-w-prose">
            The skill has no npm runtime dependency and no external skill dependencies. The
            runtime source executes without installing its development dependencies, the
            invoking agent drives the next-action loop, and the installer links the canonical
            skill directory into Claude and Codex.
          </p>
        </section>
      </main>
    </>
  );
}
