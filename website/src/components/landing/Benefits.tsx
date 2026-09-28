import { asset } from '../../lib/paths';
import { Drifter, Glow, GridDots, Rings } from '../decor';

interface Benefit {
  key: string;
  title: string;
  line: string;
  figure?: string;
  figureNote?: string;
}

const items: Benefit[] = [
  {
    key: 'outcomes',
    title: 'Verified before it merges',
    line: 'Every chunk is checked, then reviewed by a different model family, then accepted. Defects surface inside the run, not on your screen.',
    figure: '45',
    figureNote:
      'blocking defects independent review caught before merge, across the two runs that built this site.',
  },
  {
    key: 'savings',
    title: 'Big-model direction, cheap-model cost',
    line: 'A top-tier model sets the plan and integrates; Flash workers carry each chunk, so implementation runs at worker rates.',
    figure: '7.82 US dollars',
    figureNote:
      'estimated worker and reviewer spend for both runs, 156 model calls. A local estimate, not a billed figure; the coordinating model is not in it.',
  },
  {
    key: 'problems',
    title: 'A crash is a pause, not a rewrite',
    line: 'The run lives on disk. Clear the session, kill the process, come back tomorrow: resume picks up where the work stopped.',
  },
  {
    key: 'skills',
    title: 'Direct the work like a lead',
    line: 'Split a feature into independently deliverable chunks, write acceptance criteria that can be checked, and judge results at chunk boundaries.',
  },
];

export default function Benefits() {
  return (
    <section
      id="benefits"
      class="relative isolate mx-auto w-full max-w-7xl px-4 pt-4 pb-16 sm:px-6 md:pt-8 md:pb-24"
    >
      <div class="decor-field" aria-hidden="true">
        <Drifter direction="vertical" distancePx={18}>
          <Glow hue="secondary" diameterPx={640} centreXFraction={0.14} centreYFraction={0.06} opacity={0.3} />
        </Drifter>
        <Rings hue="primary" diameterPx={520} centreXFraction={0.88} centreYFraction={0.72} opacity={0.24} />
        <GridDots hue="secondary" spacingPx={28} centreXFraction={0.78} centreYFraction={0.04} opacity={0.22} />
      </div>
      <h2 data-reveal class="font-display text-display font-semibold tracking-tight">
        Delegated work, verified delivery.
      </h2>
      <p data-reveal class="mt-4 max-w-prose leading-relaxed text-dim">
        Cheap workers carry each chunk, an independent reviewer checks it, and the state on disk lets you resume any session.
      </p>
      <div class="mt-8 grid gap-6 md:grid-cols-2">
        {items.map((item) => (
          <article
            data-benefit={item.key}
            data-reveal
            class="card rounded-box border border-line bg-base-200 shadow-rest"
          >
            <div class="card-body gap-3 p-6">
              <h3 class="font-display text-title font-semibold tracking-tight">{item.title}</h3>
              <p class="text-sm leading-relaxed text-dim">{item.line}</p>
              {item.figure ? (
                <p class="mt-1 border-t border-line pt-3 text-sm leading-relaxed">
                  <span class="font-display text-lg font-semibold text-base-content">
                    {item.figure}
                  </span>{' '}
                  <span class="text-dim">{item.figureNote}</span>
                </p>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      <figure
        data-reveal
        class="mt-12 overflow-hidden rounded-box border border-line bg-base-200 shadow-raised-glow-primary"
      >
        <div class="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
          <span>status for website-polish</span>
          <span class="badge badge-soft badge-secondary font-sans text-xs shrink-0">
            The skill's own output
          </span>
        </div>
        <div class="grid items-stretch md:grid-cols-[minmax(0,32rem)_minmax(0,1fr)]">
          <div class="flex min-w-0 flex-col justify-center gap-4 border-b border-line p-6 sm:p-8 md:border-b-0 md:border-r">
            <p class="text-base leading-relaxed text-base-content">
              This site was rebuilt through Amaleh's own runs: 156 model calls, 45 blocking defects
              caught by review before merge, an estimated 7.82 US dollars of worker and reviewer
              spend.
            </p>
            <p class="text-sm leading-relaxed text-dim">
              The figures were read from the run records on 2026-09-23. The cost is pi's local
              estimate of the worker and reviewer calls, not a billed figure.
            </p>
            <p>
              <a class="link link-hover text-primary" href={asset('case-study/')}>
                Read the case study
              </a>
            </p>
          </div>
          <img
            src={asset('case-study/status-report.png')}
            alt="Terminal window showing the status report for run website-polish: the run marked done, with its host, intent, criteria, tasks, decisions and artifacts directory."
            class="h-auto w-full self-center"
            loading="lazy"
          />
        </div>
        <figcaption class="border-t border-line px-4 py-3 text-sm text-dim">
          Run <span class="font-mono">status</span> for website-polish, one of the two runs that
          built this site.
        </figcaption>
      </figure>
    </section>
  );
}
