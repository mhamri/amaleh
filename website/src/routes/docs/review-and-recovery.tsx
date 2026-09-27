import { For } from 'solid-js';
import PageMeta from '../../components/PageMeta';
import DocsLayout, { type DocsSection } from '../../components/docs/DocsLayout';
import ReviewLoop from '../../components/diagrams/ReviewLoop';
import { asset } from '../../lib/paths';
import { articleGraph } from '../../lib/seo';

const sections: DocsSection[] = [
  { id: 'independent-review', label: 'Independent cross-family review' },
  { id: 'coverage', label: 'Coverage before verdict' },
  { id: 'repair', label: 'Repair escalation' },
  { id: 'resume', label: 'Resume after interruption' },
  { id: 'diagnostics', label: 'Diagnose, host actions and export' },
];

const h2 = 'scroll-mt-24 font-display text-display font-semibold tracking-tight';
const source = 'badge badge-soft badge-info font-mono text-xs font-normal';

const repairStages = [
  ['Flash repair', 'Two ordinary repair cycles by routed Flash workers.'],
  ['Kimi repair', 'One deeper diagnosis-and-repair cycle once the Flash allowance is exhausted.'],
  ['Host takeover', 'The actual invoking model diagnoses and repairs. This is the last step: no model reviews host work, and delegate accepts it once its checks pass.'],
];

const coverageStatuses = [
  ['covered', 'The obligation was inspected and supported by named evidence.'],
  ['finding', 'A defect was identified, with a reachable scenario and evidence.'],
  ['unreviewed', 'The obligation was not examined — this blocks acceptance.'],
  ['not-applicable', 'Declared only with an explicit reason. Criteria and outcomes can never be not-applicable.'],
];

export default function DocsReviewAndRecovery() {
  const crumb = { name: 'Review and recovery', path: 'docs/review-and-recovery/' };
  const title = 'Review and recovery — Amaleh documentation';
  const description =
    'Cross-family independent review with structured coverage, the Flash to Kimi to host repair escalation, durable resume, and the diagnose, host-action and diagnostic-export operations.';
  return (
    <>
      <PageMeta
        path={crumb.path}
        title={title}
        description={description}
        structuredData={articleGraph({ crumb, headline: title, description })}
      />
      <DocsLayout
        current="review-and-recovery"
        title={crumb.name}
        lead="What keeps a delegated run honest: a reviewer from a different model family with structured coverage, bounded repair escalation, and state that survives a cleared chat, an exhausted provider or a compacted host."
        sections={sections}
      >
        <ReviewLoop />

        <section data-reveal>
          <h2 id="independent-review" class={h2}>Independent cross-family review</h2>
          <div class="mt-3 flex flex-wrap gap-2 w-full">
            <span class={source}>references/review.md</span>
          </div>
          <div class="mt-4 space-y-4 text-base leading-relaxed">
            <p>
              Review is fresh and cross-family by construction: DeepSeek writes and GLM reviews, GLM writes and DeepSeek reviews. A different provider hosting the same model family is not independence, and review candidates always exclude the author’s family; Kimi work gets a capable different family. Host work gets no model review, because a reviewer that rejects it can only send it back to the host.
            </p>
            <p>
              The reviewer receives fresh read-only context — intent, criteria, standards, the actual changed files, relevant callers and check receipts — and never the author’s reasoning or proposed verdict. It may trace affected consumers beyond the diff.
            </p>
            <p>
              One reviewer groups the baseline lenses: Spec/requirements, Standards/simplicity, correctness and omissions, with Spec and Standards coverage kept separate in the report. Jev selects additional lenses grounded in real changed behavior — money/error paths, contracts, security/authorization, migrations, visual/accessibility, resources, dependencies, test quality or observed performance. Sensitive behavior can get additional focused review in parallel.
            </p>
            <p>
              Every finding needs a reachable scenario and evidence. Observations are distinguished from inference, and new defects from unrelated inherited problems. A taste preference is not a defect, and a concurrency claim needs an actual overlap, retry or shared-state path. Duplicate claims are archived and grouped without suppressing valid evidence.
            </p>
          </div>
        </section>

        <section data-reveal>
          <h2 id="coverage" class={h2}>Coverage before verdict</h2>
          <div class="mt-3 flex flex-wrap gap-2 w-full">
            <span class={source}>references/review.md</span>
            <span class={source}>references/runtime.md</span>
          </div>
          <p class="mt-4 text-base leading-relaxed">
            Before the first review, the host maps the actual change to requirements, callers and consumers, and reachable transitions — for an orchestrator, every operation kind from start through interrupted ownership and resume. For a simple pure calculation, an inapplicable lens is declared with a reason instead of inventing safeguards.
          </p>
          <p class="mt-4 text-base leading-relaxed">
            <span class="font-mono text-sm text-base-content">review-packet</span> returns the factual contract and the exact required coverage IDs. Every review supplies <span class="font-mono text-sm text-base-content">coverage</span>: exactly one entry of id, status and evidence per obligation in the packet.
          </p>
          <div class="mt-6 overflow-x-auto rounded-box border border-line bg-base-200">
            <table class="table table-sm">
              <thead class="font-mono text-xs text-dim">
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Meaning</th>
                </tr>
              </thead>
              <tbody class="text-sm">
                <For each={coverageStatuses}>
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
          <div class="mt-6 space-y-4 text-base leading-relaxed">
            <p>
              The runtime rejects malformed coverage and blocks acceptance while entries are missing, unreviewed or findings; old receipts without coverage remain readable but cannot authorize a new acceptance. <span class="font-mono text-sm text-base-content">next</span> returns <span class="font-mono text-sm text-base-content">review-evidence-needed</span> for evidence gaps, distinct from <span class="font-mono text-sm text-base-content">triage-repair</span> for real blocking defects — and missing evidence does not consume repair cycles.
            </p>
            <p>
              For a missing executable probe, the host registers one with <span class="font-mono text-sm text-base-content">review-check</span> while verification is idle, runs it, and the invalidated review is replaced by a fresh corrected receipt that considers the new evidence. Read-only reviewers request probes; they do not execute commands.
            </p>
          </div>
        </section>

        <section data-reveal>
          <h2 id="repair" class={h2}>Repair escalation</h2>
          <div class="mt-3 flex flex-wrap gap-2 w-full">
            <span class={source}>references/review.md</span>
          </div>
          <p class="mt-4 text-base leading-relaxed">
            <span class="font-mono text-sm text-base-content">repair</span> increments a persistent counter and chooses Flash, then Kimi, then host takeover. There is no reset through rename, a new commit or a restart, and replanning retains ancestry. The initial review is not counted as a repair cycle.
          </p>
          <div class="mt-6 overflow-x-auto rounded-box border border-line bg-base-200">
            <table class="table table-sm">
              <thead class="font-mono text-xs text-dim">
                <tr>
                  <th scope="col">Stage</th>
                  <th scope="col">Allowance</th>
                </tr>
              </thead>
              <tbody class="text-sm">
                <For each={repairStages}>
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
          <div class="mt-6 space-y-4 text-base leading-relaxed">
            <p>
              Contract problems spend no repair cycles. When a worker changes files outside its task’s resources, <span class="font-mono text-sm text-base-content">delegate</span> returns a <span class="font-mono text-sm text-base-content">scope-question</span> instead of starting a repair. Widening the resources with <span class="font-mono text-sm text-base-content">amend</span> keeps the worker’s output and verifies it again with no new worker run; delegating again reverts the paths through a repair, which does spend a cycle. An <span class="font-mono text-sm text-base-content">amend</span> spends a cycle only when a check other than scope is failing or a blocking finding is open.
            </p>
            <p>
              A worker that cannot deliver the contract as written, because a check cannot pass for a reason outside the task, two criteria contradict each other, or the work needs vendor code no source supplies, raises a contract question instead of bending the work to fit. <span class="font-mono text-sm text-base-content">delegate</span> returns <span class="font-mono text-sm text-base-content">contract-question</span> before any check runs, without spending a cycle. Amending the contract spends none either, and a change to checks or resources alone keeps the output for verification; delegating again with a brief that says why the contract stands sends the output to checks and review as it stands.
            </p>
            <p>
              A reopen charges only the task it names. Its dependents carry no defect of their own: an accepted dependent keeps its output and, once its upstream is integrated again and merged into its checkout, is checked and reviewed with no worker run. A dependent whose own last attempt had already failed returns for a repair and spends a cycle.
            </p>
            <p>
              Host work is final. What the invoking model writes under <span class="font-mono text-sm text-base-content">host-exception</span> is accepted once its checks and scope pass, with no model review; a failing check sends it back to the host as <span class="font-mono text-sm text-base-content">host-checks-failed</span> without spending a cycle. The host re-reads its own diff against the task criteria and every reopen reason before recording the result.
            </p>
            <p>
              Repairs are re-reviewed over the repair delta and affected behavior, reusing conclusions only while inputs remain valid. At integration, new interactions and invalidated conclusions are reviewed rather than automatically re-running every lens.
            </p>
            <p>
              Loop bounds stop repetitive strategy, not authorized work — never use them to ship defects. Serious disputed defects require evidence inspection or main-model diagnosis: no confidence score can dismiss a failing test, and refuted findings get a corrected independent report rather than a silently edited review.
            </p>
          </div>
        </section>

        <section data-reveal>
          <h2 id="resume" class={h2}>Resume after interruption</h2>
          <div class="mt-3 flex flex-wrap gap-2 w-full">
            <span class={source}>references/recovery.md</span>
          </div>
          <div class="mt-4 space-y-4 text-base leading-relaxed">
            <p>
              Run revisions and immutable artifacts live under the target workspace’s neutral <span class="font-mono text-sm text-base-content">.amaleh</span> directory and must be retained when clearing chat or moving work. This release uses explicit material-transition checkpoints and skill-driven restoration: no native hooks are installed and no native summary replacement is claimed, so run state stays durable even if a final response or compaction hook never occurs.
            </p>
            <p>
              Invoking the skill again lists the workspace’s runs and resumes the matching one from its last checkpoint, without the old chat. <span class="font-mono text-sm text-base-content">status</span> is the small restoration index: intent, constraints, accepted decisions, current task, unresolved failures, escalation history and next actions.
            </p>
            <p>
              <span class="font-mono text-sm text-base-content">resume</span> checks worker process liveness on the recorded host and compares accepted workspace fingerprints. Interrupted work becomes blocked for reconciliation, not automatically ready: inspect session logs and actual changes, determine whether pending side effects occurred, then <span class="font-mono text-sm text-base-content">requeue</span> with evidence. A live worker is not stale merely because the chat was cleared, and <span class="font-mono text-sm text-base-content">unlock</span> only removes a demonstrably dead local lock owner.
            </p>
            <p>
              Credit exhaustion and persistent service failures preserve state; transient API retries are bounded, and once credentials or services are restored the same run resumes. An ambiguous operation result requires checking external reality before replay — this is not a guarantee of exactly-once remote execution.
            </p>
          </div>
          <p class="mt-6 text-base leading-relaxed">
            When a review workspace is missing or unreadable, <span class="font-mono text-sm text-base-content">next</span> and <span class="font-mono text-sm text-base-content">status</span> return <span class="font-mono text-sm text-base-content">reconcile-workspace</span> while independent ready candidates keep progressing. <span class="font-mono text-sm text-base-content">resume</span> preserves original artifacts and revision history, invalidates affected nonrunning verification without changing repair ancestry, and leaves live descendants owned by their workers; their results cannot be accepted until prerequisite evidence is reconciled. The runtime does not restore or relocate a checkout automatically.
          </p>
          <div class="alert alert-soft alert-info rounded-box mt-6 border border-line text-sm">
            <span>
              Closing the host does not keep a daemon running. A checkpointed run continues on the next invocation, in another session or on another day.
            </span>
          </div>
        </section>

        <section data-reveal>
          <h2 id="diagnostics" class={h2}>Diagnose, host actions and export</h2>
          <div class="mt-3 flex flex-wrap gap-2 w-full">
            <span class={source}>references/runtime.md</span>
            <span class={source}>references/recovery.md</span>
          </div>
          <p class="mt-4 text-base leading-relaxed">
            Use <span class="font-mono text-sm text-base-content">diagnose</span> before retrying unexplained failures. It returns current state, pending work, operation timelines, failures, unfinished operations and usage totals, and works even when initialization failed before a valid snapshot existed.
          </p>
          <p class="mt-4 text-base leading-relaxed">
            Its <span class="font-mono text-sm text-base-content">health</span> section measures delegation quality — coordinator-authored decisions per task, worker-side Jev calls, delegate versus manual dispatches, host takeovers per task, host-action ceremony and model-family distribution — and emits warnings naming anti-patterns such as coordinator micro-decisions, manual stepping through the worker→review→repair loop, or one task carrying the whole feature. <span class="font-mono text-sm text-base-content">finish</span> reads the same warnings and refuses on them.
          </p>
          <p class="mt-4 text-base leading-relaxed">
            <span class="font-mono text-sm text-base-content">host-action</span> records an immutable, local host observation even before run initialization or after an API failure. Kinds are decision, worker, review, edit, check, integration, permission and other; phases are planned, permission-granted, permission-denied, started, completed, failed and skipped. A retry uses a fresh action id, and summaries must never contain credentials. <span class="font-mono text-sm text-base-content">diagnose</span> includes this ledger — the records are host attestations, not proof of tool execution.
          </p>
          <figure class="mt-6 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>host-action input</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{ "actionId": "review-attempt-1", "sessionId": "host-session-1",
  "kind": "review", "phase": "planned",
  "summary": "Request fresh review of the current task",
  "taskId": "layout", "next": "Request host network permission" }`}</code></pre>
          </figure>
          <p class="mt-6 text-base leading-relaxed">
            <span class="font-mono text-sm text-base-content">diagnostic-export</span> writes a local JSON file under the run’s exports directory and returns its path and content. Its structural allowlist excludes free text, prompts, code, original action/session/task IDs, model names, paths, raw tool output and exception messages; it retains pseudonymous action/session relationships, phase and kind, task status counts and usage summaries. It works without valid run state, and nothing is uploaded automatically — inspect the result before explicitly sharing it.
          </p>
          <div class="alert alert-soft alert-warning rounded-box mt-6 border border-line text-sm">
            <span>
              Costs are separated into OpenRouter response-reported cost and pi local estimates. Neither is a reconciled billing ledger, and missing usage is unknown, not proof of zero cost.
            </span>
          </div>
          <p class="mt-6 text-base leading-relaxed">
            The exact inputs and outputs of every operation named here are in the <a class="link link-hover text-primary" href={asset('docs/commands/')}>command reference</a>; the review gate’s place in the run loop is on the <a class="link link-hover text-primary" href={asset('docs/workflow/')}>workflow</a> page.
          </p>
        </section>
      </DocsLayout>
    </>
  );
}
