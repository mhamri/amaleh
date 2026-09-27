import { For } from 'solid-js';
import PageMeta from '../../components/PageMeta';
import DocsLayout, { type DocsSection } from '../../components/docs/DocsLayout';
import RunLifecycle from '../../components/diagrams/RunLifecycle';
import { asset } from '../../lib/paths';
import { articleGraph } from '../../lib/seo';

const sections: DocsSection[] = [
  { id: 'discovery', label: 'Discovery and specification' },
  { id: 'planning', label: 'Planning and task decomposition' },
  { id: 'delegation', label: 'Delegation' },
  { id: 'parallel', label: 'Parallel execution' },
  { id: 'delivery', label: 'Verified delivery' },
];

const h2 = 'scroll-mt-24 font-display text-display font-semibold tracking-tight';
const source = 'badge badge-soft badge-info font-mono text-xs font-normal';

const outcomes = [
  ['accepted', 'The chunk passed its checks and review, or, for host work, its checks alone. Integrate next.'],
  ['escalated', 'Repair exhausted, host takeover, failed host checks, a scope question or review evidence needed — the coordinator’s turn to diagnose, answer or supply evidence.'],
  ['route-pending', 'A named prerequisite must be resolved before dispatch.'],
  ['failed', 'An infrastructure error; task state is preserved.'],
];

const parallelFields = [
  ['ready', 'Dependency-ready implementation candidates. Prepare a separate workspace per candidate, then hand the whole list to delegate-batch.'],
  ['actions', 'Per-task verification, repair, recovery and integration actions, including tasks beyond the focus.'],
  ['independent', 'A conservative batch of checks and reviews in distinct, nonconflicting workspaces, within available capacity.'],
  ['running / available', 'Current execution ownership and remaining shared slots. A suggested batch is not a reservation.'],
];

export default function DocsWorkflow() {
  const crumb = { name: 'Workflow', path: 'docs/workflow/' };
  const title = 'Workflow — Amaleh documentation';
  const description =
    'How an Amaleh run moves from discovery and planning through delegated parallel execution to verified delivery.';
  return (
    <>
      <PageMeta
        path={crumb.path}
        title={title}
        description={description}
        structuredData={articleGraph({ crumb, headline: title, description })}
      />
      <DocsLayout
        current="workflow"
        title={crumb.name}
        lead="A run is one loop: discover and specify, decompose into deliverable tasks, delegate each chunk to an isolated workspace, and accept only what survives checks, independent review and integration evidence."
        sections={sections}
      >
        <RunLifecycle />

        <section data-reveal>
          <h2 id="discovery" class={h2}>Discovery and specification</h2>
          <div class="mt-3 flex flex-wrap gap-2 w-full">
            <span class={source}>references/planning.md</span>
          </div>
          <div class="mt-4 space-y-4 text-base leading-relaxed">
            <p>
              Work starts from current code and accepted intent, not from a blank page. The host communicates with the user while workers gather facts, and Jev selects between proceeding, researching, focused grilling or brainstorming based on an actual gap. Questions go out in small rounds and only when their prerequisites are ready, each with a recommendation and its consequences. Answers are preserved as run decisions and reopened only when invalidated, so settled answers persist across sessions.
            </p>
            <p>
              Small, known work records just the objective, affected behavior, checks and one cohesive task — no separate specification or interview is required. Larger work is synthesized into an HTML specification covering problem, solution, acceptance criteria, user stories, interfaces, implementation decisions, testing and exclusions. Newly co-designed intent is reflected back for confirmation before dependent implementation starts; there are no repeated artifact-approval stages.
            </p>
          </div>
          <div class="alert alert-soft alert-info rounded-box mt-6 border border-line text-sm">
            <span>
              Human-facing specifications and graphs are authored as HTML by routed workers and archived with <span class="font-mono">save</span>. Run state, not the HTML and not chat, determines the next action.
            </span>
          </div>
        </section>

        <section data-reveal>
          <h2 id="planning" class={h2}>Planning and task decomposition</h2>
          <div class="mt-3 flex flex-wrap gap-2 w-full">
            <span class={source}>references/planning.md</span>
          </div>
          <div class="mt-4 space-y-4 text-base leading-relaxed">
            <p>
              Phase outcomes and contracts are maintained for the whole feature before tasks are detailed. Dependencies are actual prerequisites, not phase numbering: edits that must evolve together are grouped, ownership and resources are allocated, and work whose inputs are already stable is identified as a parallel candidate. The graph expands as real facts emerge while retaining task ancestry and completed evidence — and a phase is not declared complete just because its plan is written.
            </p>
            <p>
              The rule is one task per independently deliverable outcome. <span class="font-mono text-sm text-base-content">plan</span> rejects a single task that carries three or more run outcomes or four or more of its own criteria, because nothing in it can run in parallel and one worker would receive the whole feature. Split it, or pass <span class="font-mono text-sm text-base-content">singleChunk</span> with the reason the work genuinely cannot be divided; that reason is recorded and surfaces in <span class="font-mono text-sm text-base-content">diagnose</span>.
            </p>
            <p>
              A task carries its own binding guidance. <span class="font-mono text-sm text-base-content">skills</span> names installed skills and <span class="font-mono text-sm text-base-content">references</span> names design contracts or specification files; the runtime reads them at launch and inlines them into the worker’s prompt, so the coordinator names guidance instead of retyping it. An unreadable entry fails the launch and names every path it tried, so guidance is never silently missing.
            </p>
            <p>
              Later work on an existing outcome continues that run rather than starting a fresh one. <span class="font-mono text-sm text-base-content">start</span> with <span class="font-mono text-sm text-base-content">continues</span> inherits the prior run’s acceptance criteria and every settled requirement decision, so an accepted contract or interface is not re-decided from zero. Without it, <span class="font-mono text-sm text-base-content">start</span> refuses an intent that substantially repeats an existing run and names it; <span class="font-mono text-sm text-base-content">unrelated</span> with a reason overrides when the overlap is coincidental. Before it opens a run, <span class="font-mono text-sm text-base-content">start</span> fetches the project’s remote and requires the checkout’s HEAD to contain its freshly fetched default branch, unless <span class="font-mono text-sm text-base-content">base.userInstruction</span> quotes the user naming another base; create the run branch from that default branch.
            </p>
          </div>
        </section>

        <section data-reveal>
          <h2 id="delegation" class={h2}>Delegation</h2>
          <div class="mt-3 flex flex-wrap gap-2 w-full">
            <span class={source}>references/execution.md</span>
            <span class={source}>references/runtime.md</span>
          </div>
          <p class="mt-4 text-base leading-relaxed">
            The coordinator inspects <span class="font-mono text-sm text-base-content">next</span>, then hands each ready chunk to <span class="font-mono text-sm text-base-content">delegate</span>. One invocation runs the whole chunk loop autonomously: it routes and launches a worker, assembles the brief from the task contract, runs the registered checks, obtains independent other-family review, and drives repair cycles Flash → Kimi → host until acceptance or escalation. The coordinator handles only escalations, integration and feature-level verification. A worker or reviewer call stops at its configured wall-clock limit, and failed and timed-out calls still count in model-speed accounting; a reviewer call that fails without a verdict is replaced by a fresh review on another model, bounded by <span class="font-mono text-sm text-base-content">providerFailovers</span>.
          </p>
          <figure class="mt-6 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>delegate input</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{ "id": "charge", "workspace": "/abs/task-workspace" }`}</code></pre>
          </figure>
          <div class="mt-6 overflow-x-auto rounded-box border border-line bg-base-200">
            <table class="table table-sm">
              <thead class="font-mono text-xs text-dim">
                <tr>
                  <th scope="col">Outcome</th>
                  <th scope="col">Meaning</th>
                </tr>
              </thead>
              <tbody class="text-sm">
                <For each={outcomes}>
                  {(row) => (
                    <tr>
                      <th scope="row" class="font-mono text-xs font-medium text-base-content">{row[0]}</th>
                      <td class="text-dim">{row[1]}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
          <p class="mt-6 text-base leading-relaxed">
            Uncertain choices inside the chunk are made by workers themselves, through the bundled Jev helper; the coordinator reserves <span class="font-mono text-sm text-base-content">decide-batch</span> for run-level questions. Task size never authorizes direct implementation — the invoking host stays the coordinator, and direct <span class="font-mono text-sm text-base-content">worker</span> calls remain a legacy granular flow. Before any catalog or Jev call, worker routing checks dependency integration, worker capacity and live workspace conflicts: <span class="font-mono text-sm text-base-content">dispatch-blocked</span> names the prerequisite to reconcile, and the claim rechecks the same constraints transactionally.
          </p>
        </section>

        <section data-reveal>
          <h2 id="parallel" class={h2}>Parallel execution</h2>
          <div class="mt-3 flex flex-wrap gap-2 w-full">
            <span class={source}>references/parallelism.md</span>
            <span class={source}>references/execution.md</span>
          </div>
          <p class="mt-4 text-base leading-relaxed">
            When <span class="font-mono text-sm text-base-content">next.parallel.ready</span> lists more than one candidate, <span class="font-mono text-sm text-base-content">delegate-batch</span> takes every ready task id and drives them through a pool bounded by <span class="font-mono text-sm text-base-content">maxWorkers</span>, starting the next id the moment a slot frees. A sequence of single <span class="font-mono text-sm text-base-content">delegate</span> calls leaves configured capacity idle. One chunk failing never stops the others, and the batch returns when every chunk has an outcome — the skill runs no background scheduler.
          </p>
          <p class="mt-4 text-base leading-relaxed">
            Each batched task needs its own isolated checkout, prepared before the batch using the host’s supported worktree mechanism. Two tasks pointing at one checkout are refused before any worker starts, because concurrent work in one checkout serializes into ownership conflicts rather than parallel progress. Two tasks whose resources overlap, globs included, never run at once: the batch holds the later one and starts it the moment the earlier one finishes. The runtime accepts the prepared absolute workspace and merges nothing automatically; before opening the run, <span class="font-mono text-sm text-base-content">start</span> verifies the checkout against the freshly fetched remote default branch, with <span class="font-mono text-sm text-base-content">base.userInstruction</span> as the only override. Never give independent workers the main writable checkout concurrently, and on non-Git projects use host-controlled isolation with serialized work.
          </p>
          <div class="alert alert-soft alert-warning rounded-box mt-6 border border-line text-sm">
            <span>
              Preserve relevant uncommitted input explicitly: ordinary worktrees do not copy it.
            </span>
          </div>
          <div class="mt-6 overflow-x-auto rounded-box border border-line bg-base-200">
            <table class="table table-sm">
              <thead class="font-mono text-xs text-dim">
                <tr>
                  <th scope="col">next.parallel field</th>
                  <th scope="col">What it exposes</th>
                </tr>
              </thead>
              <tbody class="text-sm">
                <For each={parallelFields}>
                  {(row) => (
                    <tr>
                      <th scope="row" class="font-mono text-xs font-medium text-base-content">{row[0]}</th>
                      <td class="text-dim">{row[1]}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
          <p class="mt-6 text-base leading-relaxed">
            Within a single task, its registered checks run sequentially — builds and tests may share generated files. Across independent isolated checkouts, the same lint or build command can overlap. Checks and pi reviews hold durable activity leases: duplicate verification of one task, conflicting workspace access and capacity overflow are rejected, and interrupted ownership is reconciled through <span class="font-mono text-sm text-base-content">resume</span>.
          </p>
          <p class="mt-4 text-base leading-relaxed">
            After a task passes review and its checks, accept and integrate its actual changes, then refresh <span class="font-mono text-sm text-base-content">next</span>. Newly unlocked dependents need not wait for unrelated slow tasks. Integration writes to the run’s integration worktree, never the checkout the skill itself runs from, and remains a host-controlled serial boundary, and feature-wide integration checks are serialized too.
          </p>
        </section>

        <section data-reveal>
          <h2 id="delivery" class={h2}>Verified delivery</h2>
          <div class="mt-3 flex flex-wrap gap-2 w-full">
            <span class={source}>references/execution.md</span>
            <span class={source}>references/review.md</span>
            <span class={source}>references/runtime.md</span>
          </div>
          <div class="mt-4 space-y-4 text-base leading-relaxed">
            <p>
              Acceptance requires the task’s current checks and independent review to pass. The host then integrates the actual changes with host tools, inspecting merge conflicts and cross-task interactions, recording integration evidence and running full integration checks against the final result — task-level review cannot establish that independently correct changes compose correctly.
            </p>
            <p>
              <span class="font-mono text-sm text-base-content">finish</span> requires every task integrated, all required checks passing, and a concise claim/evidence explanation recorded per acceptance criterion, with Jev asked whether each outcome claim is supported by the actual referenced evidence. The host owns this semantic acceptance judgment; CLI check success alone cannot prove the product is correct.
            </p>
            <p>
              <span class="font-mono text-sm text-base-content">finish</span> also refuses while the health section reports delegation warnings, listing each one; an override acknowledges them with a recorded reason. The reopen warning counts only defect reopens that report a defect, not <span class="font-mono text-sm text-base-content">amend</span> reopens that only change a task contract. A run that did the work by hand cannot close silently. <span class="font-mono text-sm text-base-content">finish</span> additionally refuses while merging the freshly fetched remote default branch into the run’s checkout would conflict, naming the conflicting files.
            </p>
          </div>
          <div class="alert alert-soft alert-warning rounded-box mt-6 border border-line text-sm">
            <span>
              No rule makes failed checks optional. Parallelism changes when eligible work starts, not the evidence required for acceptance.
            </span>
          </div>
          <p class="mt-6 text-base leading-relaxed">
            The review and repair side of that acceptance gate — cross-family reviewers, coverage contracts and the Flash → Kimi → host escalation — is covered on <a class="link link-hover text-primary" href={asset('docs/review-and-recovery/')}>review and recovery</a>, and every CLI operation named here is listed in the <a class="link link-hover text-primary" href={asset('docs/commands/')}>command reference</a>.
          </p>
          <p class="mt-4 text-base leading-relaxed">
            The whole loop is also drawn as <a class="link link-hover text-primary" href={asset('workflow.html')}>the standalone interactive workflow graph</a>, shipped with this build from the repository's design artifact.
          </p>
        </section>
      </DocsLayout>
    </>
  );
}
