import { asset } from '../../lib/paths';
import { Glow, GridDots } from '../decor';

const docsTopics = [
  'The problem',
  'Getting started',
  'The workflow',
  'Review and recovery',
  'Command reference',
];

const sourceTopics = [
  'planning',
  'execution',
  'review',
  'runtime',
  'parallelism',
  'recovery',
  'verification',
  'effort',
];

export default function Continue() {
  return (
    <section class="relative isolate border-y border-line bg-base-200/50">
      <div class="decor-field" aria-hidden="true">
        <Glow hue="accent" diameterPx={640} centreXFraction={0.16} centreYFraction={0.1} opacity={0.2} />
        <GridDots hue="accent" spacingPx={28} centreXFraction={0.85} centreYFraction={0.9} opacity={0.2} />
      </div>
      <div class="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 md:py-24">
        <h2 data-reveal class="font-display text-display font-semibold tracking-tight">
          Read before you trust it.
        </h2>
        <p data-reveal class="mt-4 max-w-prose leading-relaxed text-dim">
          Five documentation pages take the workflow apart, and the case study proves each claim
          with measured figures from the runs that built this site.
        </p>
        <div class="mt-8 grid gap-6 md:grid-cols-2">
          <article data-reveal class="card rounded-box border border-line bg-base-200 shadow-rest">
            <div class="card-body gap-3 p-6">
              <div class="flex items-start justify-between gap-3">
                <h3 class="font-display text-title font-semibold tracking-tight">Documentation</h3>
                <span class="badge badge-soft badge-primary shrink-0 text-xs">Five pages</span>
              </div>
              <ul class="flex flex-wrap gap-2">
                {docsTopics.map((topic) => (
                  <li class="badge badge-soft badge-primary text-sm">{topic}</li>
                ))}
              </ul>
              <p class="text-sm leading-relaxed text-dim">
                From the problem Amaleh solves through installation, the workflow, review and
                recovery, to a command reference drawn from the skill's own reference files.
              </p>
              <a class="link link-hover text-primary" href={asset('docs/')}>
                Read the documentation
              </a>
            </div>
          </article>
          <article data-reveal class="card rounded-box border border-line bg-base-200 shadow-raised-glow-primary">
            <div class="card-body gap-3 p-6">
              <div class="flex items-start justify-between gap-3">
                <h3 class="font-display text-title font-semibold tracking-tight">Case study</h3>
                <span class="badge badge-soft badge-secondary shrink-0 text-xs">
                  Measured, with limits
                </span>
              </div>
              <p class="text-sm leading-relaxed text-dim">
                Each claim this page makes, paired with a figure from the run records: 156 model
                calls, 45 blocking defects caught by review, an estimated 7.82 US dollars of worker
                and reviewer spend, and the honest limits beside them.
              </p>
              <a class="link link-hover text-primary" href={asset('case-study/')}>
                See the case study
              </a>
            </div>
          </article>
          <article data-reveal class="card rounded-box border border-line bg-base-200 shadow-rest">
            <div class="card-body gap-3 p-6">
              <div class="flex items-start justify-between gap-3">
                <h3 class="font-display text-title font-semibold tracking-tight">Primary sources</h3>
                <span class="badge badge-soft badge-info shrink-0 text-xs">Eight files</span>
              </div>
              <ul class="flex flex-wrap gap-2">
                {sourceTopics.map((topic) => (
                  <li class="badge badge-soft badge-info font-mono font-normal text-sm">
                    {topic}.md
                  </li>
                ))}
              </ul>
              <p class="text-sm leading-relaxed text-dim">
                The skill's reference documents ship unchanged with this build, where every claim
                on this site is written out in full.
              </p>
              <a class="link link-hover text-primary" href={asset('sources/planning.md')}>
                Browse the sources
              </a>
            </div>
          </article>
        </div>
        <p data-reveal class="mt-8 text-sm leading-relaxed text-dim">
          The skill, its source and its issues are on{' '}
          <a
            class="link link-hover text-primary"
            href="https://github.com/mhamri/amaleh"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          .
        </p>
      </div>
    </section>
  );
}
