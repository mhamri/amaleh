import PageMeta from '../../components/PageMeta';
import DocsLayout, { type DocsSection } from '../../components/docs/DocsLayout';
import OperationMap from '../../components/diagrams/OperationMap';
import { asset } from '../../lib/paths';
import { articleGraph } from '../../lib/seo';

const sections: DocsSection[] = [
  { id: 'invocation', label: 'Invocation shape' },
  { id: 'run-lifecycle', label: 'Run lifecycle' },
  { id: 'planning', label: 'Planning and task contracts' },
  { id: 'delegation', label: 'Delegation' },
  { id: 'execution', label: 'Execution' },
  { id: 'review-repair', label: 'Review and repair' },
  { id: 'decisions', label: 'Decisions and routing' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'artifacts', label: 'Artifacts and fingerprints' },
  { id: 'effort', label: 'Effort path' },
  { id: 'host', label: 'Host actions and diagnostics' },
  { id: 'network', label: 'Network and preflight' },
  { id: 'environment', label: 'Environment variables' },
  { id: 'jev-helper', label: 'Worker-side Jev helper' },
];

export default function DocsCommands() {
  const crumb = { name: 'Command reference', path: 'docs/commands/' };
  const title = 'Command reference — Amaleh documentation';
  const description =
    'Every CLI operation, its purpose and its input shape, drawn from the shipped runtime reference.';
  return (
    <>
      <PageMeta
        path={crumb.path}
        title={title}
        description={description}
        structuredData={articleGraph({ crumb, headline: title, description })}
      />
      <DocsLayout
        current="commands"
        title={crumb.name}
        lead="Every CLI operation available through the Amaleh runtime, grouped by purpose. Each entry states what the operation does and the input shape it expects, drawn from the shipped runtime reference files."
        sections={sections}
      >
        <OperationMap />

        <section data-reveal>
          <h2 id="invocation" class="scroll-mt-24 font-display text-display font-semibold tracking-tight">
            Invocation shape
          </h2>
          <div class="mt-4 space-y-4 text-base leading-relaxed">
            <p>
              Run the CLI with Bun (preferred) or Node 24+ (fallback):
            </p>
            <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
              <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
                <span>sh</span>
              </div>
              <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`bun <skill>/scripts/cli.ts <operation> <workspace> <run-id> [input.json]
node <skill>/scripts/run.ts <operation> <workspace> <run-id> [input.json]`}</code></pre>
            </figure>
            <p>
              Paths are arguments, not interpolated shell commands. There are no npm runtime dependencies.
            </p>
            <p>
              The <span class="font-mono text-sm text-base-content">doctor</span> operation takes no run id. The <span class="font-mono text-sm text-base-content">list</span> operation takes only a workspace. All other operations require a workspace and a run id.
            </p>
          </div>
        </section>

        
        <section data-reveal>
          <h2 id="run-lifecycle" class="scroll-mt-24 font-display text-display font-semibold tracking-tight">
            Run lifecycle
          </h2>
          <div class="mt-3 flex flex-wrap gap-2 w-full">
            <span class="badge badge-soft badge-info font-mono text-xs font-normal">references/runtime.md</span>
          </div>
          <div class="mt-4 space-y-4 text-base leading-relaxed">
            <p>
              These operations create, inspect and close runs. A closed session is not a background scheduler; invoking the skill again lists the workspace's runs and resumes the one matching your request.
            </p>
          </div>

          <h3 id="start" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            start
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Creates a new run with a host, model, intent, acceptance criteria and constraints. Refuses if an existing run substantially repeats the same intent unless <span class="font-mono text-xs text-base-content">continues</span> or <span class="font-mono text-xs text-base-content">unrelated</span> is supplied. Pass the intent's <span class="font-mono text-xs text-base-content">shape</span>; without it, planning waits until the intent is shaped. In a Git checkout with a remote, it fetches the remote, resolves its default branch from the remote HEAD, and refuses unless HEAD contains the fetched tip, naming the branch and the Git commands that fix it; <span class="font-mono text-xs text-base-content">base.userInstruction</span>, quoting the user, is the only override. A workspace outside Git, or with no remote, records <span class="font-mono text-xs text-base-content">base-unverified</span> and proceeds.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{
  "host": { "kind": "codex", "model": "actual model from session" },
  "intent": "requested outcome",
  "criteria": ["observable success"],
  "constraints": ["accepted restriction"],
  "continues": "<optional prior run id>",
  "unrelated": "<optional reason when word overlap is coincidental>",
  "base": { "userInstruction": "<optional quote from the user naming another base>" },
  "shape": { "understanding": "what is asked and what it is for", "clearCut": "why there is only one sensible reading" }
}`}</code></pre>
          </figure>

          <h3 id="feedback" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            feedback
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Records the user's feedback as a new request. Planning, amending, reopening and delegating wait until it is shaped. Chunks that are already running finish; nothing new starts on the old understanding.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{ "text": "the user's actual words" }`}</code></pre>
          </figure>

          <h3 id="shape" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            shape
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Shapes the latest request before any plan: the understanding, what is missing, pushback, additions, a reusable principle when one is warranted, and two to four real options with a recommendation. Pass <span class="font-mono text-xs text-base-content">clearCut</span> instead of options when the request has only one sensible reading. Options without <span class="font-mono text-xs text-base-content">chosen</span>, or open questions, make <span class="font-mono text-xs text-base-content">next</span> return <span class="font-mono text-xs text-base-content">ask-user</span>. The chosen option becomes a requirement decision.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{
  "understanding": "the hero must sell the product in one glance",
  "gaps": ["no headline copy was supplied"],
  "pushback": ["three paragraphs bury the animation"],
  "additions": ["show every model's logo"],
  "mentor": ["a hero earns attention with one promise, not a feature list"],
  "options": [
    { "id": "headline", "summary": "one headline and one line", "gains": "scene stays visible", "costs": "less detail" },
    { "id": "split", "summary": "copy left, scene right", "gains": "both readable", "costs": "scene shrinks on phones" }
  ],
  "recommendation": "headline",
  "affects": ["hero"],
  "chosen": { "option": "headline", "quote": "the user's words" }
}`}</code></pre>
          </figure>

          <h3 id="list" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            list
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Returns one summary per run in a workspace — id, status, intent, acceptance criteria, task count, revision, the run it continues and its acceptance record — newest revision first. Read it before starting anything.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>sh</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`bun amaleh/scripts/cli.ts list ./my-project`}</code></pre>
          </figure>

          <h3 id="status" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            status
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Returns the run's current state including durable references and phase status. No input required beyond the workspace and run id.
          </p>

          <h3 id="next" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            next
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Returns the next recommended action for the run. No input required. Exposes <span class="font-mono text-xs text-base-content">parallel.ready</span> candidates and <span class="font-mono text-xs text-base-content">parallel.available</span> worker capacity.
          </p>

          <h3 id="diagnose" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            diagnose
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Returns current state, pending work, operation timelines, failures, unfinished operations and usage totals. Includes host-action ledger, telemetry diagnostics, and process health. Also works when initialization failed before a valid snapshot existed.
          </p>

          <h3 id="resume" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            resume
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Resumes a closed run. On a new host or model, pass the actual current coordinator so the handoff retains prior identity and allows escalation.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{ "host": { "kind": "claude", "model": "actual current coordinator" } }`}</code></pre>
          </figure>

          <h3 id="html" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            html
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Returns a local HTML progress artifact. No input required.
          </p>

          <h3 id="doctor" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            doctor
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Local check only. Reports runtime engine and version, platform, pi executable, whether OpenRouter credentials are configured, and the Jev endpoint. Does not prove network connectivity. Takes no workspace or run id.
          </p>

          <h3 id="install" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            install
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Links the canonical skill into the default Codex and Claude skill directories. Refuses conflicting targets. Windows uses directory junctions; Unix uses symlinks. Takes no workspace or run id.
          </p>

          <h3 id="uninstall" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            uninstall
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            The inverse of <span class="font-mono text-xs text-base-content">install</span>, with the same optional home argument. Removes only the two skill links when they resolve to the canonical skill directory and reports each target as <span class="font-mono text-xs text-base-content">removed</span> or <span class="font-mono text-xs text-base-content">not installed</span>. It never removes the checkout, and a real directory, a file or a link that resolves elsewhere is refused with <span class="font-mono text-xs text-base-content">Conflicting skill target: &lt;target&gt;</span>, leaving both targets untouched. Rerunning it reports every target as not installed. Takes no workspace or run id.
          </p>
        </section>

        
        <section data-reveal>
          <h2 id="planning" class="scroll-mt-24 font-display text-display font-semibold tracking-tight">
            Planning and task contracts
          </h2>
          <div class="mt-4 space-y-4 text-base leading-relaxed">
            <p>
              These operations define and modify the work graph. Plans add tasks, not discard history. A task may carry <span class="font-mono text-xs text-base-content">skills</span> and <span class="font-mono text-xs text-base-content">references</span> which the runtime reads at launch.
            </p>
          </div>

          <h3 id="plan" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            plan
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Defines the task graph. Each task needs its own independently deliverable outcome — one task carrying three or more outcomes, or four or more criteria, is refused because nothing in it can run in parallel.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{
  "tasks": [
    {
      "id": "charge",
      "title": "Correct charge",
      "goal": "Apply the agreed amount rule",
      "phase": "checkout",
      "deps": [],
      "resources": ["checkout"],
      "criteria": ["expected totals hold"],
      "kind": "code",
      "checks": [
        { "id": "test", "command": "bun", "args": ["test", "test/charge.test.js"] }
      ],
      "skills": ["optional-skill-name"],
      "references": ["path/to/design-contract.md"]
    }
  ],
  "integrationChecks": [
    { "id": "all", "command": "bun", "args": ["test"] }
  ]
}`}</code></pre>
          </figure>
          <p class="mt-4 text-sm leading-relaxed text-dim">
            Commands use executable plus argument arrays. Register actual project checks, not invented test commands. <span class="font-mono text-xs text-base-content">singleChunk</span> overrides division when work genuinely cannot be split.
          </p>

          <h3 id="amend" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            amend
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Changes an existing task contract while retaining identity and escalation ancestry. Sends affected descendants back as <span class="font-mono text-xs text-base-content">invalidate</span> does. Do not create a replacement ID merely to reset repair history. An amendment spends a repair cycle only when the task is in review with a failing check other than <span class="font-mono text-xs text-base-content">scope</span>, or an open blocking finding, and never when it answers a worker's contract question. An amendment that changes only <span class="font-mono text-xs text-base-content">resources</span> on a task holding a finished output with no open blocking finding keeps that output, so the next <span class="font-mono text-xs text-base-content">delegate</span> verifies it again with no new worker run; when it answers a contract question, a change to <span class="font-mono text-xs text-base-content">checks</span> keeps the output too. Add <span class="font-mono text-xs text-base-content">"feedback": true</span> when the change delivers shaped user feedback naming this task; that reopen spends no repair cycle. An amendment is recorded as a contract reopen, while <span class="font-mono text-xs text-base-content">invalidate</span> records a defect reopen; only defect reopens count in the reopen health warning and <span class="font-mono text-xs text-base-content">metrics.reopenedChunks</span>.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{
  "id": "charge",
  "reason": "actual changed requirement or diagnosis",
  "task": { ...complete updated task contract... }
}`}</code></pre>
          </figure>

          <h3 id="invalidate" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            invalidate
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Invalidates a task and its dependents when an accepted assumption or piece of evidence changes. Repair ancestry remains, and the reopen spends a repair cycle on the named task only. Its dependents carry no defect of their own and spend nothing: an accepted one keeps its output and, once the named task is integrated again and merged into its checkout, <span class="font-mono text-xs text-base-content">delegate</span> checks and reviews it with no worker run. A dependent whose own last attempt had already failed returns for a repair and spends a cycle. Reopening a delivered task needs the probe that found the defect as <span class="font-mono text-xs text-base-content">check</span>; it joins the task's checks and runs on every later repair. Pass <span class="font-mono text-xs text-base-content">noProbe</span> with a reason when no executable can show the defect; it is accepted once per task. <span class="font-mono text-xs text-base-content">"feedback": true</span> reopens a task named by settled user feedback, with no probe and no repair cycle.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{
  "id": "charge",
  "reason": "which accepted assumption/evidence changed",
  "check": { "id": "totals", "command": "bun", "args": ["test", "test/charge.test.js"] }
}`}</code></pre>
          </figure>

          <h3 id="record-decision" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            record-decision
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Records a settled intent decision without a Jev call. Use source <span class="font-mono text-xs text-base-content">host</span> only for delegated technical decisions. Never invent a user answer.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{
  "id": "intent-answer",
  "question": "What outcome?",
  "answer": "The user's actual answer",
  "source": "user",
  "reason": "Reference to the actual instruction"
}`}</code></pre>
          </figure>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            <span class="font-mono text-xs text-base-content">block</span> accepts an optional task <span class="font-mono text-xs text-base-content">id</span> to block only that task and its dependents while unrelated work proceeds.
          </p>
        </section>

        
        <section data-reveal>
          <h2 id="delegation" class="scroll-mt-24 font-display text-display font-semibold tracking-tight">
            Delegation
          </h2>
          <div class="mt-4 space-y-4 text-base leading-relaxed">
            <p>
              One coordinator invocation per chunk routes, launches the worker, assembles the brief, runs checks, obtains review, applies Jev course-correction, and drives repair cycles. Do not call <span class="font-mono text-xs text-base-content">worker</span>, <span class="font-mono text-xs text-base-content">check</span>, <span class="font-mono text-xs text-base-content">reviewer</span>, or <span class="font-mono text-xs text-base-content">repair</span> manually for a delegated chunk.
            </p>
          </div>

          <h3 id="delegate" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            delegate
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Delegates a whole chunk to the runtime. Outcomes: <span class="font-mono text-xs text-base-content">accepted</span> (chunk done, integrate next), <span class="font-mono text-xs text-base-content">escalated</span> (repair-exhausted / host-takeover / host-checks-failed / scope-question / contract-question / refresh-checkout / review-evidence — your turn), <span class="font-mono text-xs text-base-content">route-pending</span> (resolve the named prerequisite), <span class="font-mono text-xs text-base-content">failed</span> (infrastructure error; task state preserved). Host work is final: work the host wrote under <span class="font-mono text-xs text-base-content">host-exception</span> is accepted once its checks and scope pass, with no model review. A failing scope check spends no repair cycle; it returns <span class="font-mono text-xs text-base-content">scope-question</span> so the coordinator can widen the resources or delegate again to revert the paths. A worker that finds its contract wrong, such as a check that cannot pass for a reason outside the task, raises a contract question instead of working around it; <span class="font-mono text-xs text-base-content">delegate</span> returns <span class="font-mono text-xs text-base-content">contract-question</span> before any check runs, with no repair cycle spent, and the coordinator amends the contract or delegates again with a <span class="font-mono text-xs text-base-content">brief</span> saying why the contract stands; without a brief that call is refused. A dependent kept after its upstream was reopened returns <span class="font-mono text-xs text-base-content">refresh-checkout</span> until its checkout contains the new upstream. The <span class="font-mono text-xs text-base-content">brief</span> also reaches every repair worker the call starts. A reviewer call that fails for any reason other than a workspace escape or a settled funding or authorization failure is replaced by a fresh review on another model, bounded by <span class="font-mono text-xs text-base-content">providerFailovers</span>; when that budget runs out the chunk fails and the task stays in review with its worker output.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{
  "id": "charge",
  "workspace": "absolute task workspace",
  "brief": "optional extra guidance",
  "lenses": ["optional review lenses"],
  "skills": ["optional override skill"],
  "references": ["optional override reference"]
}`}</code></pre>
          </figure>

          <h3 id="delegate-batch" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            delegate-batch
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Delegates every ready chunk in one invocation, bounded by <span class="font-mono text-xs text-base-content">maxWorkers</span>. Each task needs its own isolated checkout, and <span class="font-mono text-xs text-base-content">briefs</span> carries extra guidance for single chunks. The batch runs in a detached process, so the call returns within seconds with <span class="font-mono text-xs text-base-content">{'{ launched, pid, ids, cursor, log }'}</span>. Follow it with <span class="font-mono text-xs text-base-content">wait</span>. The final outcomes land in <span class="font-mono text-xs text-base-content">log</span>; one chunk failing never stops the others. Two chunks whose <span class="font-mono text-xs text-base-content">resources</span> overlap, globs included, never run at once: the batch holds the later one and starts it the moment the earlier one finishes.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{
  "ids": ["hero", "docs", "pricing"],
  "briefs": { "hero": "optional guidance for this chunk only" },
  "lenses": ["optional review lenses"],
  "skills": ["optional shared skill"],
  "references": ["optional shared contract"]
}`}</code></pre>
          </figure>

          <h3 id="wait" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            wait
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Follows a running batch. Returns as soon as a chunk finishes, a batch process is gone, nothing is running, or the timeout passes. The outcome is <span class="font-mono text-xs text-base-content">finished</span>, <span class="font-mono text-xs text-base-content">interrupted</span>, <span class="font-mono text-xs text-base-content">idle</span> or <span class="font-mono text-xs text-base-content">still-running</span>, with the finished chunks, a new cursor and the next action. Pass the cursor back on the next call and keep going until it reports idle.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{ "after": 812, "timeoutMs": 100000 }`}</code></pre>
          </figure>
        </section>

        
        <section data-reveal>
          <h2 id="execution" class="scroll-mt-24 font-display text-display font-semibold tracking-tight">
            Execution
          </h2>
          <div class="mt-4 space-y-4 text-base leading-relaxed">
            <p>
              These operations handle the low-level execution of individual tasks, checks and model routing. They are called internally by <span class="font-mono text-xs text-base-content">delegate</span> and are listed here for completeness.
            </p>
          </div>

          <h3 id="claim" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            claim
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Claims a fresh matching worker route for a task. A fresh route is required and consumed atomically; an arbitrary model name is insufficient. For direct host exceptions, first call <span class="font-mono text-xs text-base-content">host-exception</span>.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{
  "id": "charge",
  "workspace": "absolute task workspace",
  "model": "actual selected model",
  "routeDecisionId": "decisionId returned by route",
  "hostAuthorization": "returned by host-exception (alternative)"
}`}</code></pre>
          </figure>

          <h3 id="worker" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            worker
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Invokes a worker. Selects a model automatically, invokes pi, records real model and session output, and checkpoints the result. Never concurrently run workers in the same checkout.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{ "id": "charge", "workspace": "...", "brief": "...", "routing": { ... } }`}</code></pre>
          </figure>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Result: <span class="font-mono text-xs text-base-content">{'{ "id": "charge", "output": { "changes": ["..."], "remaining": [] } }'}</span>.
          </p>

          <h3 id="check" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            check
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Runs a registered executable check, saves output and fingerprints. If a check changes files, rerun checks invalidated by those changes before acceptance. Omit <span class="font-mono text-xs text-base-content">id</span> for a feature integration check.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{ "id": "charge", "checkId": "test" }`}</code></pre>
          </figure>

          <h3 id="route" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            route
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Selects a worker or reviewer model. Selection is deterministic round-robin across eligible models, seeded by the run's session hash. A model that exhausted retries is skipped for five minutes, and a model measured at least twice as slow as its role's median is skipped for that role until its slow calls age out of <span class="font-mono text-xs text-base-content">slowModelWindowMs</span>. Finding no eligible candidates returns <span class="font-mono text-xs text-base-content">route-blocked</span>.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{
  "id": "charge",
  "purpose": "worker",
  "workspace": "absolute checkout",
  "routing": {
    "role": "configured optional role",
    "requiredInputs": ["text"],
    "contextTokens": 8000,
    "evidence": "Observed requirements and model suitability evidence"
  }
}`}</code></pre>
          </figure>

          <h3 id="result" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            result
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Records the output of a completed worker execution.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{ "id": "charge", "output": { "changes": ["..."], "remaining": [] } }`}</code></pre>
          </figure>
        </section>

        
        <section data-reveal>
          <h2 id="review-repair" class="scroll-mt-24 font-display text-display font-semibold tracking-tight">
            Review and repair
          </h2>
          <div class="mt-4 space-y-4 text-base leading-relaxed">
            <p>
              Independent review verifies each chunk with structured coverage. Findings route back into the worker's repair loop, not to the coordinator.
            </p>
          </div>

          <h3 id="reviewer" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            reviewer
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Invokes a fresh read-only pi review. Uses the review coverage contract with entries for id, status and evidence. The prompt asks for every blocking defect the reviewer can find in one pass, grouping lenses that share a root defect into one finding. Vendor code or setup for a third-party service that the task added with no source in the workspace or the task's references is a blocking finding. A reply that is not a valid report is asked for once more in the reviewer's own session, so its inspection is kept.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{
  "id": "charge",
  "lenses": ["Spec", "Standards", "Correctness", "Omissions"],
  "routing": { "evidence": "Relevant suitability evidence" }
}`}</code></pre>
          </figure>

          <h3 id="review" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            review
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Records a review obtained through a supported native agent. Never fabricate a reviewer identity or report. Findings require id, lens, location, scenario, evidence, consequence and a boolean blocking field.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{
  "id": "charge",
  "model": "actual reviewer model",
  "fingerprint": "from fingerprint operation",
  "report": "coverage and findings evidence",
  "findings": []
}`}</code></pre>
          </figure>

          <h3 id="review-packet" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            review-packet
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Returns factual review context and exact required coverage IDs. Both the pi reviewer and the standalone <span class="font-mono text-xs text-base-content">review</span> operation use these coverage entries.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{ "id": "charge", "lenses": ["optional specific lenses"] }`}</code></pre>
          </figure>

          <h3 id="review-check" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            review-check
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Registers an additional unique task check while review is idle, invalidates the old review, and retains repair counters.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{ "id": "charge", "check": { "id": "test", "command": "bun", "args": ["test"] } }`}</code></pre>
          </figure>

          <h3 id="repair" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            repair
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Triggers a repair cycle. Updates the persistent escalation counter.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{ "id": "charge" }`}</code></pre>
          </figure>

          <h3 id="accept" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            accept
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Accepts a completed task after review passes and all checks are satisfied.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{ "id": "charge" }`}</code></pre>
          </figure>

          <h3 id="integrated" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            integrated
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Records integration after the host integrates changes and checks compatibility. The evidence must be actual interaction inspection. It compares the task's checkout with the accepted output, so record it before removing the task's worktree; once the checkout is gone it refuses and names the missing path.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{ "id": "charge", "evidence": "actual integration and interaction inspection evidence" }`}</code></pre>
          </figure>

          <h3 id="finish" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            finish
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Closes a run after all tasks are integrated, required checks pass and Jev claim-support decisions are resolved. While a task is not accepted and integrated it refuses, naming each such task and its state. A finished run cannot change; later work starts a new run with <span class="font-mono text-xs text-base-content">continues</span>. Claims are host attestations, not cryptographic proof. Refuses while health reports delegation warnings; <span class="font-mono text-xs text-base-content">acknowledgeWarnings</span> overrides and records a durable event. It also fetches the remote default branch and refuses while merging it into HEAD would conflict, naming the conflicting files.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{
  "claims": ["evidence explanation corresponding to each run criterion"],
  "acknowledgeWarnings": "reason for overriding warnings (optional)"
}`}</code></pre>
          </figure>
        </section>

        
        <section data-reveal>
          <h2 id="decisions" class="scroll-mt-24 font-display text-display font-semibold tracking-tight">
            Decisions and routing
          </h2>
          <div class="mt-4 space-y-4 text-base leading-relaxed">
            <p>
              These operations handle model selection, Jev-based decisions, and model pool configuration.
            </p>
          </div>

          <h3 id="decide" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            decide
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Settles a bounded either/or question. Uses actual evidence, not empty routing ceremony. Response chooses an option or yields <span class="font-mono text-xs text-base-content">host-decision</span>. OpenRouter Jev uses the decisions endpoint, not chat completions.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{
  "id": "unique-decision",
  "question": "Which route is justified?",
  "criteria": { "source": "Read relevant code", "execute": "Evidence is sufficient" },
  "state": { "task": "...", "facts": ["..."] }
}`}</code></pre>
          </figure>

          <h3 id="decide-batch" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            decide-batch
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Settles up to sixteen independent questions in one gateway call. Always prefer it over repeated <span class="font-mono text-xs text-base-content">decide</span> calls. Each answer is recorded individually.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{
  "decisions": [
    { "id": "...", "question": "...", "criteria": { ... }, "state": { ... } }
  ]
}`}</code></pre>
          </figure>

          <h3 id="host-decision" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            host-decision
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Records a decision made directly by the host coordinator. The host is the source of truth for its own reasoning.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{ "id": "unique-decision", "choice": "source", "reason": "evidence and reasoning" }`}</code></pre>
          </figure>

          <h3 id="pools" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            pools
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Persists purpose-specific routing preferences. Filter against the current catalog capability facts before dispatch; configuring a model does not prove eligibility.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{
  "pools": [
    {
      "role": "frontend",
      "models": ["verified exact model IDs"],
      "requiredInputs": ["text", "image"],
      "requiresTools": true,
      "notes": "User preference and relevant evidence"
    }
  ]
}`}</code></pre>
          </figure>

          <h3 id="catalog" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            catalog
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Fetches dated candidate cards including capability, price and source. Select stable eligible models and record exact IDs. No input required.
          </p>
        </section>

        
        <section data-reveal>
          <h2 id="configuration" class="scroll-mt-24 font-display text-display font-semibold tracking-tight">
            Configuration
          </h2>
          <div class="mt-4 space-y-4 text-base leading-relaxed">
            <p>
              Operations that modify runtime settings and task state.
            </p>
          </div>

          <h3 id="configure" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            configure
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Sets positive integer values for operational limits. <span class="font-mono text-xs text-base-content">maxWorkers</span> changes freely. The repair budget is the user's policy, so changing <span class="font-mono text-xs text-base-content">flashRepairCycles</span> or <span class="font-mono text-xs text-base-content">deepRepairCycles</span> needs <span class="font-mono text-xs text-base-content">userInstruction</span> quoting the user's request.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{ "maxWorkers": 4, "flashRepairCycles": 3, "userInstruction": "Give Flash three tries before Kimi" }`}</code></pre>
          </figure>

          <h3 id="block" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            block
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Pauses a task or the entire run pending external intervention. When a task id is provided, only that task and its dependents are blocked.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{ "id": "charge (optional)", "reason": "external failure and intervention needed" }`}</code></pre>
          </figure>

          <h3 id="requeue" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            requeue
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Returns a blocked task to ready state. Only for blocked tasks; the evidence must document that interrupted effects have been inspected and reconciled.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{ "id": "charge", "evidence": "interrupted effects inspected and reconciled" }`}</code></pre>
          </figure>

          <h3 id="unlock" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            unlock
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Verifies a dead same-host lock owner before removing a stale lock. Never delete a live or unverifiable lock.
          </p>

          <h3 id="host-exception" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            host-exception
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Grants a one-use authorization for a direct host exception when the worker model must differ from the routed model. Requires explicit evidence of user instruction or repair escalation after the persistent allowance is exhausted. Host work is final: after <span class="font-mono text-xs text-base-content">result</span>, <span class="font-mono text-xs text-base-content">delegate</span> runs the task checks and accepts with no model review, so re-read your own diff before recording the result.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{ "id": "charge", "reason": "user-request", "evidence": "actual explicit user instruction" }`}</code></pre>
          </figure>
        </section>

        
        <section data-reveal>
          <h2 id="artifacts" class="scroll-mt-24 font-display text-display font-semibold tracking-tight">
            Artifacts and fingerprints
          </h2>
          <div class="mt-4 space-y-4 text-base leading-relaxed">
            <p>
              Evidence storage, retrieval and content fingerprinting.
            </p>
          </div>

          <h3 id="save" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            save
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Archives any JSON evidence and returns a content ID.
          </p>

          <h3 id="artifact" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            artifact
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Retrieves the original evidence for a saved content ID.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{ "id": "artifact hash" }`}</code></pre>
          </figure>

          <h3 id="fingerprint" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            fingerprint
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Returns the exact current content fingerprint for a workspace. Optional — defaults to the command workspace.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{ "workspace": "absolute task workspace (optional)" }`}</code></pre>
          </figure>
        </section>

        
        <section data-reveal>
          <h2 id="effort" class="scroll-mt-24 font-display text-display font-semibold tracking-tight">
            Effort path
          </h2>
          <div class="mt-4 space-y-4 text-base leading-relaxed">
            <p>
              These five operations implement the conditional same-model effort path. A host/model switch must first reconcile any active effort pass. See the <a class="link link-hover text-primary" href={asset('sources/effort.md')}>effort reference</a> for validated input shapes and host execution requirements.
            </p>
          </div>

          <h3 id="effort-configure" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            effort-configure
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Configures the effort path parameters for a run. Must be called before requesting or starting an effort pass.
          </p>

          <h3 id="effort-request" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            effort-request
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Requests an effort pass. The host must supply valid configuration first.
          </p>

          <h3 id="effort-start" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            effort-start
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Records that an effort pass has started execution.
          </p>

          <h3 id="effort-finish" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            effort-finish
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Records that an effort pass has completed.
          </p>

          <h3 id="effort-reconcile" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            effort-reconcile
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Reconciles an effort pass, resolving execution state. A host/model switch must first reconcile any active effort pass before resuming.
          </p>
        </section>

        
        <section data-reveal>
          <h2 id="host" class="scroll-mt-24 font-display text-display font-semibold tracking-tight">
            Host actions and diagnostics
          </h2>
          <div class="mt-4 space-y-4 text-base leading-relaxed">
            <p>
              Operations for recording host observations, exporting diagnostic data, and reconciling execution.
            </p>
          </div>

          <h3 id="host-action" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            host-action
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Records an immutable local host observation. Works before run initialization or after an API failure. Kinds: <span class="font-mono text-xs text-base-content">decision</span>, <span class="font-mono text-xs text-base-content">worker</span>, <span class="font-mono text-xs text-base-content">review</span>, <span class="font-mono text-xs text-base-content">edit</span>, <span class="font-mono text-xs text-base-content">check</span>, <span class="font-mono text-xs text-base-content">integration</span>, <span class="font-mono text-xs text-base-content">permission</span>, <span class="font-mono text-xs text-base-content">other</span>. Phases: <span class="font-mono text-xs text-base-content">planned</span>, <span class="font-mono text-xs text-base-content">permission-granted</span>, <span class="font-mono text-xs text-base-content">permission-denied</span>, <span class="font-mono text-xs text-base-content">started</span>, <span class="font-mono text-xs text-base-content">completed</span>, <span class="font-mono text-xs text-base-content">failed</span>, <span class="font-mono text-xs text-base-content">skipped</span>.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{
  "actionId": "review-attempt-1",
  "sessionId": "host-session-1",
  "kind": "review",
  "phase": "planned",
  "summary": "Request fresh review of the current task",
  "taskId": "layout",
  "next": "Request host network permission"
}`}</code></pre>
          </figure>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            <span class="font-mono text-xs text-base-content">taskId</span> and <span class="font-mono text-xs text-base-content">next</span> are optional. Summaries should contain concise reasons and local evidence references, never credentials.
          </p>

          <h3 id="diagnostic-export" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            diagnostic-export
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Writes a local JSON file under the run's exports directory and returns its path. Works without valid run state. The structural allowlist excludes free text, prompts, code, model names, paths and raw tool output. No input required beyond the workspace and run id.
          </p>

          <h3 id="reconcile-execution" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            reconcile-execution
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            For legacy running claims only. Accepts a trusted host attestation that task execution has stopped. Archives the prior task and releases ownership into blocked state. Inspect preserved artifacts, then use <span class="font-mono text-xs text-base-content">requeue</span> and route again.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{
  "id": "charge",
  "operation": "exact current owner operation",
  "confirmedStopped": true,
  "evidence": "evidence of stopped execution"
}`}</code></pre>
          </figure>

          <h3 id="health" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            health
          </h3>
          <p class="mt-3 text-sm leading-relaxed text-dim">
            Standalone health check. Measures delegation quality — coordinator-authored decisions per task, worker-side Jev calls, delegate versus manual dispatches, host takeovers per task, host-action ceremony, model-family distribution, contract questions and the coordinator's own state-changing operations — and emits warnings. State revisions are shown as a plain count: the runtime saves most of them inside <span class="font-mono text-xs text-base-content">delegate</span>, so they measure the work, not the coordinator. <span class="font-mono text-xs text-base-content">finish</span> reads the same warnings and refuses on them. It also reports each model's speed per role — calls, failures, average and longest minutes, with failed and timed-out calls' elapsed time counted — and names any model at least twice as slow as the median for its role; a slow model never blocks <span class="font-mono text-xs text-base-content">finish</span>. No input required.
          </p>
        </section>

        
        <section data-reveal>
          <h2 id="network" class="scroll-mt-24 font-display text-display font-semibold tracking-tight">
            Network and preflight
          </h2>
          <h3 id="preflight" class="mt-8 scroll-mt-24 font-display text-title font-semibold tracking-tight">
            preflight
          </h3>
          <div class="mt-3 space-y-4 text-sm leading-relaxed text-dim">
            <p>
              Validates credentials and a fixed synthetic Jev choice with one request and a ten-second timeout. Run it before the first network operation in a session.
            </p>
          </div>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>input.json</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`{ "network": "restricted|allowed|unknown", "channel": "actual host execution channel" }`}</code></pre>
          </figure>
          <p class="mt-4 text-sm leading-relaxed text-dim">
            Known restricted networking performs zero requests. No project content is included, no permission is granted, and no global setting is changed. <span class="font-mono text-xs text-base-content">doctor</span> remains a local check; it does not prove network connectivity.
          </p>
        </section>

        
        <section data-reveal>
          <h2 id="environment" class="scroll-mt-24 font-display text-display font-semibold tracking-tight">
            Environment variables
          </h2>
          <p class="mt-4 text-sm leading-relaxed text-dim">
            The runtime reads these environment variables. None are written by the CLI.
          </p>
          <div class="mt-4 overflow-x-auto rounded-box border border-line bg-base-200">
            <table class="table table-sm">
              <thead class="font-mono text-xs text-dim">
                <tr>
                  <th scope="col">Variable</th>
                  <th scope="col">Purpose</th>
                </tr>
              </thead>
              <tbody class="text-sm">
                <tr>
                  <td class="font-mono text-xs font-medium text-base-content">OPENROUTER_API_KEY</td>
                  <td class="text-dim">OpenRouter credential. The runtime never prints or writes it into artifacts.</td>
                </tr>
                <tr>
                  <td class="font-mono text-xs font-medium text-base-content">AMALEH_PI_ENTRY</td>
                  <td class="text-dim">Names the installed pi JavaScript entry if the default resolution is wrong.</td>
                </tr>
                <tr>
                  <td class="font-mono text-xs font-medium text-base-content">AMALEH_RUNTIME</td>
                  <td class="text-dim">Override the runtime executable. Checked before AMALEH_NODE.</td>
                </tr>
                <tr>
                  <td class="font-mono text-xs font-medium text-base-content">AMALEH_NODE</td>
                  <td class="text-dim">Fallback executable path for pi. Checked after AMALEH_RUNTIME.</td>
                </tr>
                <tr>
                  <td class="font-mono text-xs font-medium text-base-content">AMALEH_HOST_PID</td>
                  <td class="text-dim">Optional process ID to record as the host process for claim operations.</td>
                </tr>
                <tr>
                  <td class="font-mono text-xs font-medium text-base-content">AMALEH_JEV_MODEL</td>
                  <td class="text-dim">Verified current OpenRouter Jev model ID, used when the installed default becomes stale.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        
        <section data-reveal>
          <h2 id="jev-helper" class="scroll-mt-24 font-display text-display font-semibold tracking-tight">
            Worker-side Jev helper
          </h2>
          <div class="mt-4 space-y-4 text-base leading-relaxed">
            <p>
              Workers consult Jev mid-task without the coordinator through the bundled helper. Worker briefs include the invocation automatically; calls are recorded as <span class="font-mono text-xs text-base-content">worker-jev</span> events.
            </p>
          </div>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>sh</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`node <skill>/scripts/jev.ts <workspace> <run-id> <task-id> "<question>" "<optionA>|<optionB>|..."`}</code></pre>
          </figure>
          <p class="mt-4 text-sm leading-relaxed text-dim">
            The helper accepts a workspace path, a run id, a task id, a question string, and pipe-separated option strings. It returns Jev's chosen option. This keeps worker-side decisions inside the chunk loop without escalating to the coordinator.
          </p>
          <p class="mt-4 text-sm leading-relaxed text-dim">
            Jev chooses between options inside the task contract; it cannot repair the contract. A worker that finds the contract itself wrong raises a contract question through the second bundled helper, then finishes its run without working around it. <span class="font-mono text-xs text-base-content">delegate</span> returns <span class="font-mono text-xs text-base-content">contract-question</span> to the coordinator.
          </p>
          <figure class="mt-4 overflow-hidden rounded-box border border-line bg-base-200 shadow-rest">
            <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
              <span>sh</span>
            </div>
            <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed"><code>{`node <skill>/scripts/question.ts <run workspace> <run-id> <task-id> "<what is wrong, with the evidence>" [check-id]`}</code></pre>
          </figure>
        </section>
      </DocsLayout>
    </>
  );
}
