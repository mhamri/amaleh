import ModelTopology from '../diagrams/ModelTopology';
import { Drifter, Glow, LightRays } from '../decor';
import { DECISION, REPAIR, WORKER_LIST } from '../../lib/pool';

const roles = [
  {
    name: 'Coordinator',
    chip: 'minimal turns',
    chipClass: 'badge badge-soft badge-primary shrink-0 text-xs',
    body: 'The expensive model, kept to minimal turns. Clarifies intent, chunks work, defines acceptance criteria and integrates results. One delegate call per chunk.',
  },
  {
    name: 'Workers',
    chip: 'routed Flash pool',
    chipClass: 'badge badge-soft badge-accent shrink-0 text-xs',
    body: `The routed Flash families (${WORKER_LIST}) each own a chunk end to end: implementation, checks and repair cycles. Uncertain inside the chunk, they consult ${DECISION.name} directly instead of escalating.`,
  },
  {
    name: 'Reviewer',
    chip: 'read-only',
    chipClass: 'badge badge-soft badge-secondary shrink-0 text-xs',
    body: 'Always the other model family, reading only. It verifies each chunk with structured coverage and routes findings back into the worker\'s repair loop rather than to the coordinator.',
  },
  {
    name: DECISION.name,
    chip: 'bounded decisions',
    chipClass: 'badge badge-soft badge-accent shrink-0 text-xs',
    body: `A cheap decision model answering bounded either/or questions for workers and the coordinator. TypeScript code, not any model, enforces dependencies, ownership, checks and review coverage.`,
  },
];

const mechanics = [
  {
    lead: 'Routing is deterministic.',
    body: 'Round-robin across eligible model families, seeded by the run\'s session hash, so work spreads across vendors instead of fixating on one.',
  },
  {
    lead: 'Only genuine boundaries escalate.',
    body: `Exhausted repair allowances (Flash to ${REPAIR.name} to host), missing evidence and ambiguous intent reach the expensive model; ordinary uncertainty goes to ${DECISION.name}.`,
  },
  {
    lead: 'Progress lives on disk.',
    body: 'A closed session resumes from disk on the next invocation, with its artifacts still in place.',
  },
];

export default function Division() {
  return (
    <section class="relative isolate mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 md:py-24">
      <div class="decor-field" aria-hidden="true">
        <Drifter direction="horizontal" distancePx={20}>
          <LightRays hue="primary" apexXFraction={0.92} apexYFraction={-0.04} angleDegrees={18} spreadDegrees={116} opacity={0.2} />
        </Drifter>
        <Glow hue="accent" diameterPx={620} centreXFraction={0.08} centreYFraction={0.86} opacity={0.2} />
      </div>
      <h2 data-reveal class="font-display text-display font-semibold tracking-tight">
        Who does what.
      </h2>
      <div class="mt-4 grid items-start gap-10 lg:grid-cols-[minmax(0,32rem)_minmax(0,1fr)] lg:gap-14">
        <div class="min-w-0 max-w-prose" data-reveal>
          <p class="leading-relaxed text-dim">
            The coordinator holds the direction. Everything inside a chunk runs without it and comes
            back as one outcome to inspect and integrate.
          </p>
          <p class="mt-4 leading-relaxed text-dim">
            Brass marks the coordinator sending chunks out to the routed worker models. Violet marks
            the bounded questions workers put to {DECISION.name}. Teal marks a chunk reviewed by another family
            and accepted back.
          </p>
          <h3 class="mt-10 font-display text-title font-semibold tracking-tight">
            How it stays cheap.
          </h3>
          <ul class="mt-4 list-inside list-disc space-y-2 leading-relaxed text-dim">
            {mechanics.map((item) => (
              <li>
                <span class="text-base-content">{item.lead}</span> {item.body}
              </li>
            ))}
          </ul>
        </div>
        <ModelTopology />
      </div>
      <div class="mt-12 grid gap-6 md:grid-cols-2">
        {roles.map((role) => (
          <article
            data-reveal
            class="card rounded-box border border-line bg-base-200 shadow-rest-glow-accent"
          >
            <div class="card-body gap-3 p-6">
              <div class="flex items-start justify-between gap-3">
                <h3 class="font-display text-title font-semibold tracking-tight">{role.name}</h3>
                <span class={role.chipClass}>{role.chip}</span>
              </div>
              <p class="text-sm leading-relaxed text-dim">{role.body}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
