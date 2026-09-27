# Amaleh

**عمله** is pronounced **ʿamaleh** (roughly **Ah-mah-leh**) and means **workers / laborers** in Persian. *Amaleh* is the project's Latin-script name: coordinated workers contributing to a shared, verified outcome.

**Why Amaleh exists: top-tier models are too expensive to do the work.** Without structure, an expensive model spends its premium context writing every edit, every check, every micro-decision. Amaleh turns that model into a director instead of a laborer: it segments work into chunks with clear outcomes, delegates each chunk to cheap Flash models, and only verifies direction at chunk boundaries. The result is the same verified delivery at a fraction of the token cost.

A self-contained workflow skill for Codex and Claude: discovery, planning, delegated parallel implementation, independent review and verified delivery. Disk checkpoints let another session resume the work.

How the division of labor works:

- **Coordinator (expensive model, minimal turns):** clarifies intent, chunks the work, defines acceptance criteria, integrates results. One `delegate` call per chunk; no per-step instructions, no hand-written briefs, no micro-management.
- **Workers (cheap Flash models via pi/OpenRouter):** own a chunk end to end — implementation, checks, repair cycles. When uncertain, they consult **Jev** directly through a bundled helper instead of escalating to the coordinator.
- **Reviewer (the other Flash family, read-only):** independently verifies each chunk with structured coverage; findings route back into the worker's repair loop, not to the coordinator.
- **Jev (cheap decision model):** answers bounded either/or questions for workers and the coordinator; TypeScript code — not any model — enforces dependencies, ownership, checks and review coverage.
- **Routing:** deterministic round-robin across eligible model families seeded by the run's session hash, so work spreads across vendors instead of fixating on one.
- **Escalation:** only genuine boundaries reach the expensive model — exhausted repair allowances (Flash → Kimi → host), missing evidence, ambiguous intent.

The host prepares workspaces and integrates results. This is not an unattended background service: a closed session resumes from disk on the next invocation.

## Setup

Use Bun, or Node 24 or newer for the fallback launcher. Configure pi with OpenRouter, or provide `OPENROUTER_API_KEY` through your environment. Never put credentials in the repository.

First clone the repository to a stable location:

```sh
git clone https://github.com/mhamri/amaleh
cd amaleh
```

Installation links `amaleh/` into the current user's Codex and Claude skill directories, so the clone must live somewhere you will not move or delete. From that checkout root, run:

```sh
bun amaleh/scripts/run.ts doctor
bun amaleh/scripts/run.ts install
```

Installation refuses conflicting destinations; keep the checkout in place after installation. `uninstall` reverses it:

```sh
bun amaleh/scripts/run.ts uninstall
```

It removes only the two skill links, never the checkout, and reports each target as `removed` or `not installed`. A real directory, a file or a link that points elsewhere at either target is refused with `Conflicting skill target: <target>`, and nothing is removed. Invoke `/amaleh` with your task; the skill handles the workflow and resume steps.

The host runs a synthetic startup preflight through its permitted execution channel before network work. Amaleh does not edit global permission settings. Network access and permission to send project context remain host-controlled.

## Documentation

- [Website source](website/): SolidStart with reusable Solid components and daisyUI, prerendered for GitHub Pages.

- [Skill entry point](amaleh/SKILL.md)
- [CLI operations and inputs](amaleh/references/runtime.md)
- [Execution and network permissions](amaleh/references/execution.md)
- [Review and acceptance](amaleh/references/review.md)
- [Verification and limitations](amaleh/references/verification.md)
- [Interactive workflow graph](DESIGN.html): open the downloaded file in a browser, or browse the copy shipped with the website at `/workflow.html`, linked from the [workflow documentation page](website/src/routes/docs/workflow.tsx).

## Diagnostics

`diagnose` reads durable state, runtime traces, host-reported actions and a **process-health** assessment: coordinator decisions per task, worker-side Jev usage, delegation vs manual dispatch, and model-family distribution, with warnings that name the exact anti-pattern when a run drifts back into expensive-model micro-management. `host-action` records native edits, delegation, permission outcomes and next steps across sessions. `diagnostic-export` creates a local summary with free text and source identifiers omitted; it never uploads it. See the [command reference](amaleh/references/runtime.md#host-actions-and-diagnostic-export).

### Checking a finished run

Run these from the repository the run worked in. `<skill>` is the installed skill directory, typically `~/.claude/skills/amaleh`.

```sh
bun <skill>/scripts/run.ts list .
bun <skill>/scripts/run.ts health . <run-id>
```

`list` gives each run's id, status, intent and task count. `health` answers whether the run was delegated or driven by hand. Read two things from it:

- `warnings` — empty means none of the six anti-patterns fired: manual loop stepping, coordinator micro-decisions, no worker-side Jev, recording ceremony, single-vendor fixation, or one task carrying the whole feature.
- `coordinatorDecisions` — should be at or near zero, and `delegations` should be at least `tasks`.

`health` deliberately stays quiet about chunks that failed and recovered, because a run that stumbles and retries is still a healthy run. To see what the stumbles cost, read the outcomes and the check receipts from the newest revision:

```sh
last=$(ls .amaleh/runs/<run-id>/revision-*.json | tail -1)
jq -r '[.events[]|select(.type=="delegate-finished")|.detail.outcome]
       |group_by(.)|map({(.[0]):length})|add' "$last"
jq -r '.tasks[]|"\(.id): \(.status) [\([.receipts[]|.id+":"+(.code|tostring)]|join(", "))]"' "$last"
```

The first prints outcomes by kind — `accepted`, `failed`, `escalated`, `route-pending`. Anything other than `accepted` was retried or needed a decision. The second prints every registered check and its exit code; acceptance already requires all of them to be `0` at the accepted fingerprint, so a non-zero value means the task was never accepted.

A run is fine when `health` reports no warnings and every task is `accepted`. Investigate when a warning names an anti-pattern, when a task sits in any other status, or when the failure count is high enough that retries dominate the run.

## Development

```sh
cd amaleh
bun install --frozen-lockfile
bun run check
bun run test:node
bun test tests/*.test.ts
```

Tests use local fixtures, not paid model calls. Build and preview the graph from the repository root:

```sh
bun design/build.ts
bun design/preview.ts
```

Preview binds loopback port 4179; `AMALEH_PREVIEW_PORT` selects another port. Both scripts also run with modern Node. Edit `design/viewer.ts` and `design/template.html`, then rebuild `DESIGN.html`.

Local runs, credentials, screenshots, development reports and intermediate bundles are excluded. Windows execution has been tested; macOS/Linux use portable APIs but have not yet been exercised here.

## Website development and GitHub Pages

The marketing site uses SolidStart, Solid, Tailwind CSS, and daisyUI. All seven routes — `/`, `/docs/`, `/case-study/`, `/docs/getting-started/`, `/docs/workflow/`, `/docs/review-and-recovery/` and `/docs/commands/` — are prerendered to complete HTML; Solid hydrates the interactive controls. Primary-source notes are copied from this repository during the build, and the interactive workflow graph ships alongside them as `workflow.html`. No agent credentials are required to build or host the website.

```sh
cd website
npm ci
npm run check
npm run build
npm run test:static
npm run preview
```

Preview opens a static server at `http://127.0.0.1:4180`. For development, use `npm run dev`. Use Node 24 or newer; CI pins the latest stable verified release listed in [dependency sources](website/DEPENDENCIES.md).

Set `SITE_BASE=/amaleh/` when building and previewing this repository as a GitHub project site (PowerShell: `$env:SITE_BASE='/amaleh/'`; POSIX shell: `export SITE_BASE=/amaleh/`). The default is `/` for local development or a custom domain. The static check verifies that links and assets stay within the configured base path.

[The Pages workflow](.github/workflows/pages.yml) installs the lockfile, type-checks, builds, and validates the rendered output on pull requests. Pushes or manual runs on the default branch also upload `website/.output/public` and deploy it to GitHub Pages. In repository **Settings → Pages → Build and deployment**, select **GitHub Actions** once, then merge these changes to the default branch. CI derives `/repository-name/` automatically (or `/` for an `owner.github.io` repository); set the repository Actions variable `SITE_BASE` to `/` for a custom domain. Deployment requires the repository's Pages environment to allow the default branch.

Only the explicit public build is uploaded, never the repository root or `.amaleh` state. See [website dependency sources](website/DEPENDENCIES.md) for versions, verification dates, and update guidance.

## License

MIT. See [LICENSE](LICENSE).
