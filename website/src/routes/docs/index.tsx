import { For } from 'solid-js';
import PageMeta from '../../components/PageMeta';
import DocsLayout, { type DocsSection } from '../../components/docs/DocsLayout';
import ModelTopology from '../../components/diagrams/ModelTopology';
import { asset } from '../../lib/paths';
import { DECISION, REPAIR, WORKER_LIST } from '../../lib/pool';
import { DOCS_CRUMB, articleGraph } from '../../lib/seo';

const sections: DocsSection[] = [
  { id: 'problem', label: 'The problem Amaleh solves' },
  { id: 'division', label: 'How the work is divided' },
  { id: 'routing', label: 'Routing and escalation' },
  { id: 'host', label: 'What stays with the host' },
];

const roles = [
  {
    name: 'Coordinator',
    badge: 'minimal turns',
    badgeClass: 'badge badge-soft badge-primary shrink-0 text-xs',
    body: 'Clarifies intent, chunks the work, defines acceptance criteria and integrates the results. One delegate call per chunk: no per-step instructions, no hand-written briefs, no micro-management.',
  },
  {
    name: 'Workers',
    badge: 'pi / OpenRouter',
    badgeClass: 'badge badge-soft badge-info shrink-0 text-xs',
    body: `The routed Flash families — ${WORKER_LIST} — each own a chunk end to end: implementation, checks and repair cycles. When a choice inside the chunk is uncertain they consult ${DECISION.name} directly through the bundled helper instead of escalating to the coordinator.`,
  },
  {
    name: 'Reviewer',
    badge: 'read-only',
    badgeClass: 'badge badge-soft badge-secondary shrink-0 text-xs',
    body: 'The other Flash family independently verifies each chunk with structured coverage. Findings route back into the worker’s repair loop, not to the coordinator.',
  },
  {
    name: DECISION.name,
    badge: 'bounded decisions',
    badgeClass: 'badge badge-soft badge-accent shrink-0 text-xs',
    body: 'Answers bounded either/or questions for the workers and the coordinator. Dependencies, ownership, checks and review coverage are enforced by TypeScript code, not by a model.',
  },
];

const escalation = [
  ['Flash repair', 'The routed worker', 'Default repair of review findings, inside the chunk’s own loop.'],
  [`${REPAIR.name} repair`, 'A deeper specialist model', 'Justified deeper work once the Flash repair allowance is exhausted.'],
  ['Host', 'The coordinator', 'Justified escalated diagnosis, missing evidence and genuine external blockers. The last step: host work is accepted on its checks, with no model review.'],
];

export default function DocsOverview() {
  const title = 'Overview — Amaleh documentation';
  const description =
    `Why Amaleh exists, and how the coordinator, workers, reviewer and ${DECISION.name} divide the work of a delegated run.`;
  return (
    <>
      <PageMeta
        path={DOCS_CRUMB.path}
        title={title}
        description={description}
        structuredData={articleGraph({ crumb: DOCS_CRUMB, headline: title, description })}
      />
      <DocsLayout
        current="overview"
        title="Overview"
        lead="Amaleh is a self-contained workflow skill for Codex and Claude: discovery, planning, delegated parallel implementation, independent review and verified delivery. This page explains why it exists and who does what."
        sections={sections}
      >
        <section data-reveal>
          <h2 id="problem" class="scroll-mt-24 font-display text-display font-semibold tracking-tight">
            The problem Amaleh solves
          </h2>
          <div class="mt-4 space-y-4 text-base leading-relaxed">
            <p>
              Top-tier models are too expensive to do the work. Without structure, an expensive model spends its premium context writing every edit, every check and every micro-decision. Amaleh turns that model into a director instead of a laborer: it segments the work into chunks with clear outcomes, delegates each chunk to cheap Flash models, and verifies direction only at the chunk boundaries.
            </p>
            <p>
              The project's name is <span lang="fa" dir="rtl">عمله</span> — Persian in origin, pronounced{' '}
              <span class="text-base-content">Ah-mah-leh</span>, meaning{' '}
              <span class="text-base-content">workers / laborers</span>. <em>Amaleh</em> is the
              Latin-script name for coordinated workers contributing to a shared, verified outcome.
            </p>
            <p class="mt-4">
              Two things make that delegation safe. Each chunk is reviewed independently by a different model family while it runs, and each material outcome is checkpointed to disk. A checkpointed run continues in another session, on another day, without replaying the conversation that produced it.
            </p>
          </div>
          <div class="alert alert-soft alert-info rounded-box mt-6 border border-line text-sm">
            <span>
              Amaleh is not an unattended background service. A closed session resumes from disk on the next invocation, and the host keeps control of network access and project context.
            </span>
          </div>
        </section>

        <section data-reveal>
          <h2 id="division" class="scroll-mt-24 font-display text-display font-semibold tracking-tight">
            How the work is divided
          </h2>
          <p class="mt-4 text-base leading-relaxed">
            Four roles carry a run. The expensive model coordinates, cheap models execute, a second cheap family reviews, and a third cheap role answers the questions that would otherwise stall either of them.
          </p>
          <ModelTopology class="mt-8" />
          <div class="mt-8 grid gap-6 md:grid-cols-2">
            <For each={roles}>
              {(role) => (
                <article class="card rounded-box border border-line bg-base-200 shadow-rest">
                  <div class="card-body gap-3 p-6">
                    <div class="flex items-start justify-between gap-3">
                      <h3 class="font-display text-title font-semibold tracking-tight">{role.name}</h3>
                      <span class={role.badgeClass}>{role.badge}</span>
                    </div>
                    <p class="text-sm leading-relaxed text-dim">{role.body}</p>
                  </div>
                </article>
              )}
            </For>
          </div>
          <p class="mt-6 text-base leading-relaxed">
            The coordinator works like a director: clarify intent, segment the work into chunks with clear outcomes and acceptance criteria, hand each chunk over, then inspect the returned evidence and integrate it. Everything inside a chunk — implementation, in-task decisions, checks, independent review and repair cycles — runs without the coordinator in the loop.
          </p>
        </section>

        <section data-reveal>
          <h2 id="routing" class="scroll-mt-24 font-display text-display font-semibold tracking-tight">
            Routing and escalation
          </h2>
          <p class="mt-4 text-base leading-relaxed">
            Worker and reviewer models are chosen by deterministic round-robin across eligible stable Flash families, seeded by the run’s session hash, so work spreads across vendors instead of fixating on one. No {DECISION.name} call is spent on mechanical selection. A provider that fails its retry budget is skipped for five minutes, which costs capacity rather than the whole run. A model whose average call takes at least twice the median of its configured peers for a role is skipped for that role only, until its slow calls are a week old.
          </p>
          <p class="mt-4 text-base leading-relaxed">
            Only genuine boundaries reach the expensive model: an exhausted repair allowance, missing evidence, or ambiguous intent. Repair escalation is enforced by persistent counters inside the chunk loop, so the coordinator only sees the final escalation.
          </p>
          <div class="mt-6 overflow-x-auto rounded-box border border-line bg-base-200">
            <table class="table table-sm">
              <thead class="font-mono text-xs text-dim">
                <tr>
                  <th scope="col">Repair stage</th>
                  <th scope="col">Who acts</th>
                  <th scope="col">When it is used</th>
                </tr>
              </thead>
              <tbody class="text-sm">
                <For each={escalation}>
                  {(row) => (
                    <tr>
                      <th scope="row" class="font-mono text-xs font-medium text-base-content">{row[0]}</th>
                      <td class="text-dim">{row[1]}</td>
                      <td class="text-dim">{row[2]}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </section>

        <section data-reveal>
          <h2 id="host" class="scroll-mt-24 font-display text-display font-semibold tracking-tight">
            What stays with the host
          </h2>
          <div class="mt-4 space-y-4 text-base leading-relaxed">
            <p>
              The host prepares an isolated workspace for each task and integrates the accepted results. Integration stays serial: parallel chunks work in their own checkouts, and their changes meet again in the main workspace.
            </p>
            <p>
              Network access and permission to send project context remain host-controlled, and Amaleh never edits global permission settings. Credentials stay in the host environment or in pi’s configuration, never in the repository.
            </p>
          </div>
          <p class="mt-6 text-base leading-relaxed">
            Continue with <a class="link link-hover text-primary" href={asset('docs/getting-started/')}>getting started</a> for the prerequisites and the first run, or read the <a class="link link-hover text-primary" href={asset('docs/commands/')}>command reference</a> for the CLI operations behind each step.
          </p>
        </section>
      </DocsLayout>
    </>
  );
}