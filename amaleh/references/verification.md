# Implementation verification — 2026-09-19

The skill installer links the canonical directory into Claude and Codex. There are no external skill dependencies and no npm runtime dependencies. The invoking agent drives the next-action loop and performs native host interactions, workspace preparation and integration. This is not an unattended daemon or an automatic merge service.

## Evidence

- A real OpenRouter Jev decisions request succeeded using pi's existing OpenRouter credential. No separate TypeSafe key is required. Response model: typesafe/jev-1.13-20260917. OpenRouter uses its alpha decisions endpoint; the adapter does not send Jev requests to chat completions.
- A live isolated billing fixture traversed Jev routing → deepseek/deepseek-v4.1-flash implementation → z-ai/glm-5.3-flash independent read-only review → exact amount tests → acceptance/integration/completion. The task corrected multiplication of unit price by quantity; tests covered expected totals 20 and 5.
- Behavioral tests cover valid completion, graph validation, stale/failed checks, independent review, repair escalation, concurrent checkpointing, dependency-ready progress, conflicting workspaces, live/dead ownership, decision uncertainty, artifact retention, HTML escaping, installation reruns, uninstall round trips, uninstall reruns, uninstall refusal of a real directory or a foreign link, completed-run resume, upstream invalidation that charges only the reopened task and re-verifies its dependents once their checkout holds the new upstream, cross-host takeover, final host work accepted on its checks, scope questions, contract questions, contract amendment, batches that hold chunks with overlapping resources, reviewer format corrections in the same session, debugger-wait commands stopped at once, checks that fail beside others and pass alone, a check lock that keeps isolated runs apart whatever order their names sort in and clears holders that crashed or stopped refreshing, stopped worker calls routed to another family only when they changed nothing, amendments that ask accepted work for more, and spend priced from the recorded catalog card.
- Static checking uses TypeScript strict mode. The skill-creator validator passes.
- Bun-first launching and Node fallback were exercised, including an empty PATH that makes Bun unavailable.

## Verified dependency/runtime sources

All checks dated 2026-09-19. Exact development dependencies and transitive resolution are recorded in the Bun lockfile; runtime source executes without installing them.

| Component | Verified version | Authority |
|---|---|---|
| Bun | 1.4.2 | https://api.github.com/repos/oven-sh/bun/releases/latest |
| Node latest stable | 26.9.0 | https://nodejs.org/dist/index.json |
| Node additional compatibility | installed 24.19.0 | Local executable; not claimed latest |
| pi | 0.85.1 | https://registry.npmjs.org/@earendil-works%2Fpi-coding-agent/latest |
| TypeScript, development only | 7.0.2 | https://registry.npmjs.org/typescript/latest |
| Node types, development only | 26.6.2 | https://registry.npmjs.org/%40types%2Fnode/latest |
| Jev OpenRouter model | ~typesafe/jev-latest (alias; typesafe/jev-1.13 also passes) | `preflight` returned ready for both ids on 2026-09-25 |

## Practical limits

Host effort now has a durable, Jev-selected escalation path (baseline → supported higher effort → baseline) with seven behavioral tests. Native execution is performed by the invoking host using verified session or same-model delegation capabilities, then recorded with execution evidence. The runtime does not silently alter global settings or claim an in-place effort change when it actually launched a separate pass. pi worker thinking configuration remains separate and is not implied by this host-effort feature.

Windows was exercised. macOS/Linux paths use portable APIs but those platforms have not been run here. No Claude/Codex lifecycle hooks are installed; resume relies on explicit material-transition checkpoints and loading the skill's durable state. Native host compaction is not replaced. pi retains complete worker sessions. The host must provide applicable project instructions because worker discovery of external skills and context files is disabled.

Workspace fingerprints are conservative whole-tree content hashes excluding runtime state, Git metadata and node_modules. Unrelated source changes may invalidate more evidence than a future precise dependency model would. Acceptance descriptions and host integration receipts are trusted agent attestations; code verifies registered checks and freshness, while the host/Jev must inspect semantic claim support. A live model smoke test is not a general quality/cost benchmark.

Secrets are read from existing credential configuration or environment and are not intentionally placed into logs or command-line arguments. Original tool artifacts are retained; their contents still depend on the commands the user authorizes.

## Open measurements

These behaviours are built and tested against synthetic models, but no real run has yet shown the saving they exist for. The next diagnostic of a real run settles each one; until then, treat the saving as unproven.

**The light review is not yet shown to cost less.** See [review effort](review.md#review-effort). The baseline is a full review of a change under 200 lines: about 13,500 output tokens and 4 minutes, measured over 84 reviews of past runs. In the one real run that had a light review, it used 8,963 output tokens, and a full review in the same run used 8,515. pi applied `--thinking low`, but `xiaomi/mimo-v2.6-flash` wrote as much thinking as at its default level (25,715 characters against 20,419). `~deepseek/deepseek-flash-latest`, `~z-ai/glm-flash-latest` and `stealth/space-bunny-alpha` have not been measured as light reviewers. To judge it, run `health` on a real run and compare:

- `metrics.reviews.light` with `metrics.reviews.total`, and the `reason` of each `review-effort` event whose effort is `full`. Jev answered `light` at confidence 0.79 for a pure function of 19 lines, below the 0.85 bar; a bar that makes almost every review full is itself a finding.
- The minutes and output tokens of light and full reviewer calls in `.amaleh/model-speed.jsonl`.

When light reviews are not cheaper on real work, set `lightReviewLines` to `0` in `models.json`, which makes every review full.

**New files in the reviewer's diff have not run on a real model.** See [the review coverage contract](runtime.md#review-coverage-contract). Before the diff held new files, a reviewer of a task that added one file spent about 10 of its 17 tool calls on `ls`, `find` and `grep` to find what had changed. Check the reviewer session of a new-file task: those searches should be gone.

**Reviewer time varies for the same work, and the cause is not known.** The same reviewer model took 12 minutes and then 2.7 minutes to review the same ten-line function in two runs. One comparison of two runs therefore proves nothing about speed; compare medians over several reviews.

## Reproducible verification

From `amaleh/`, run `bun install --frozen-lockfile`, `bun run check`, `bun run test` and `bun run test:node`. `bun run test` is the suite of record; Bun is the default runtime and Node is the fallback, so `test:node` proves the same files pass there too.

### The Node test runner

`test:node` runs Node's test runner over the same files in two passes. The files that do not start Git run first, at most half the machine's threads at a time: every file at once pushes the timing-tight tests past their limits. The files that start Git (any test file whose source names `'git'`) then run one file at a time, because several Git fixtures that clone, commit and merge at once slow each other past their test time limits on Windows. The exit code is a failure when either pass fails.

The offline suite covers routing, lifecycle recovery, parallel ownership, review coverage, context isolation and startup preflight. Latest development check, 2026-09-28: 287 Bun tests and 298 Node tests (including nested cases) passed. Live probes above are historical development observations, not offline-suite requirements or general model-quality claims. Raw development artifacts and review reports are not distributed.

From the repository root, build the standalone viewer with `bun design/build.ts` or `node design/build.ts`. DESIGN.html is shipped; design/viewer.generated.js is an ignored intermediate.

Startup preflight cannot grant network access or authorize project-data export. Previously accepted historical runs are not retroactively re-reviewed by the coverage gate.

Execution authorization rejects plain claims and consumes a fresh matching worker route or scoped single-use host exception. This is an authorization gate, not proof that a model actually performed edits. pi records its process/session evidence; native execution and explicit user instructions remain trusted host attestations. Arbitrary host filesystem edits are outside this runtime boundary.
