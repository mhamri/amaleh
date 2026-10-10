# Implementation verification — 2026-09-19

The skill installer links the canonical directory into Claude and Codex. There are no external skill dependencies and no npm runtime dependencies. The invoking agent drives the next-action loop and performs native host interactions, workspace preparation and integration. This is not an unattended daemon or an automatic merge service.

## Evidence

- A real OpenRouter Jev decisions request succeeded using pi's existing OpenRouter credential. No separate TypeSafe key is required. Response model: typesafe/jev-1.13-20260917. OpenRouter uses its alpha decisions endpoint; the adapter does not send Jev requests to chat completions.
- A live isolated billing fixture traversed Jev routing → deepseek/deepseek-v4.1-flash implementation → z-ai/glm-5.3-flash independent read-only review → exact amount tests → acceptance/integration/completion. The task corrected multiplication of unit price by quantity; tests covered expected totals 20 and 5.
- Live `bench` runs of the scenario `design-card` on 2026-10-11 built a statistics card from its PNG picture alone. All three image-capable flash models built a card that matches on the first try, with 0 of the 17 measured elements and text lines outside the limits: `~z-ai/glm-flash-latest` (run `design-card-15`: 4.2 minutes, 19,187 worker output tokens, $0.024 for the run), `~deepseek/deepseek-flash-latest` (run `design-card-16`: 1.8 minutes, 9,989 tokens, $0.018) and `xiaomi/mimo-v2.6-flash` (run `design-card-17`: 10.7 minutes, 23,955 tokens, $0.014). Three earlier runs were accepted with every scorecard row passing although the card was wrong, and the measurement of solid elements and text lines now fails each of them. In run `design-card-11` the bars of `~z-ai/glm-flash-latest` were 17 to 18% too narrow and the card sat 13 pixels to the left; the mean channel difference was 9.7 of 255, under the limit of 15, and the judge `xiaomi/mimo-v2.6-flash` called the difference minor. In run `design-card-12` (`xiaomi/mimo-v2.6-flash`) the amount was 12% too tall, and in run `design-card-14` (`~z-ai/glm-flash-latest`, repaired by `xiaomi/mimo-v2.6-flash`) it was 17% too narrow and 15% too short. In all three the month labels were 69 to 80 RGB away from their dim color, because the brief listed only the large color groups; the brief now lists every text line with its ink color. Runs `design-card-1` and `design-card-13` (both `~deepseek/deepseek-flash-latest`) matched. Before the worker brief stated the judge's blocking and minor differences, `~z-ai/glm-flash-latest` (run `design-card-2`) kept moving elements by a few pixels until the 45-minute worker limit stopped it; 14.5 minutes in, its bars sat 14 pixels too low, and its last card holds.
- Behavioral tests cover valid completion, graph validation, stale/failed checks, independent review, repair escalation, concurrent checkpointing, dependency-ready progress, conflicting workspaces, live/dead ownership, decision uncertainty, artifact retention, HTML escaping, installation reruns, uninstall round trips, uninstall reruns, uninstall refusal of a real directory or a foreign link, completed-run resume, upstream invalidation that charges only the reopened task and re-verifies its dependents once their checkout holds the new upstream, cross-host takeover, final host work accepted on its checks, scope questions, contract questions, contract amendment, batches that hold chunks with overlapping resources, reviewer format corrections in the same session, debugger-wait commands stopped at once, checks that fail beside others and pass alone, a check lock that keeps isolated runs apart whatever order their names sort in and clears holders that crashed or stopped refreshing, stopped worker calls routed to another family only when they changed nothing, amendments that ask accepted work for more, spend priced from the recorded catalog card, PNG decoding of every color type, bit depth, row filter and Adam7 interlace, solid elements and text lines measured in a picture and paired with those of a build against the size, place and ink color limits, the saved builds of runs `design-card-1`, `design-card-11`, `design-card-12` and `design-card-14` passing or failing that measurement as they should, design pictures stored and refused at plan and amend, render checks that write no picture, a non-PNG or the design picture itself, a visual judge chosen from image-capable models outside the author's family, routing of a task with pictures to image models only with the picture attached to worker and reviewer, the repair brief carrying the output of failing checks, the screenshot helper against a real browser, and every scenario of the pool planning as a valid contract.
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

**The light review is not yet shown to cost less.** See [review effort](review.md#review-effort). The baseline is a full review of a change under 200 lines: about 13,500 output tokens and 4 minutes, measured over 84 reviews of past runs. In the one real run that had a light review, it used 8,963 output tokens, and a full review in the same run used 8,515. pi applied `--thinking low`, but `xiaomi/mimo-v2.6-flash` wrote as much thinking as at its default level (25,715 characters against 20,419). The next real run, a design task in another project, made 0 of its 37 reviews light. Its 24 `review-effort` decisions were full for these reasons: 16 changes were over 200 lines, 5 changes could not be measured, and 3 small changes got a Jev confidence of 0.35, 0.45 and 0.69, under the 0.85 bar. That run therefore says nothing about the cost of a light review. The first light review in a run came from the scenario `design-card` (run `design-card-11`, Jev confidence 0.98, 120 changed lines in 1 file): `~deepseek/deepseek-flash-latest` used 2,218 output tokens and 14 seconds. A full review of the same card by `~z-ai/glm-flash-latest` (run `design-card-1`) used 2,155 output tokens and 23 seconds, so this pair shows no saving in output tokens either. Runs `design-card-12` to `design-card-17` made all of their reviews light, each at Jev confidence 0.98 for 79 to 172 changed lines in 1 file, and had no full review to compare with. Their light reviews used 1,065 and 945 output tokens in 8 and 10 seconds for `~z-ai/glm-flash-latest`, 3,017, 8,393 and 5,235 tokens in 63, 54 and 66 seconds for `~deepseek/deepseek-flash-latest`, and 4,656 tokens in 153 seconds for `xiaomi/mimo-v2.6-flash`. The review after the repair in run `design-card-14` kept the light effort, as a follow-up review by the same model does, and used 1,720 tokens. To judge it, run `health` on a real run and compare:

- `metrics.reviews.light` with `metrics.reviews.total`, and the `reason` of each `review-effort` event whose effort is `full`. Jev answered `light` at confidence 0.79 for a pure function of 19 lines, below the 0.85 bar; a bar that makes almost every review full is itself a finding.
- The minutes and output tokens of light and full reviewer calls in `.amaleh/model-speed.jsonl`.

When light reviews are not cheaper on real work, set `lightReviewLines` to `0` in `models.json`, which makes every review full.

**New files in the reviewer's diff have not run on a real model.** See [the review coverage contract](runtime.md#review-coverage-contract). Before the diff held new files, a reviewer of a task that added one file spent about 10 of its 17 tool calls on `ls`, `find` and `grep` to find what had changed. Check the reviewer session of a new-file task: those searches should be gone. One real session so far supports this: in run `design-card-11` of the scenario `design-card`, whose task added the one file `card.html`, the reviewer `~deepseek/deepseek-flash-latest` made 5 tool calls: 3 file reads, 1 `find` for `AGENTS.md` and 1 `ls`.

**Reviewer time varies for the same work, and the cause is not known.** The same reviewer model took 12 minutes and then 2.7 minutes to review the same ten-line function in two runs. One comparison of two runs therefore proves nothing about speed; compare medians over several reviews.

## Reproducible verification

From `amaleh/`, run `bun install --frozen-lockfile`, `bun run check`, `bun run test` and `bun run test:node`. `bun run test` is the suite of record; Bun is the default runtime and Node is the fallback, so `test:node` proves the same files pass there too.

### The Node test runner

Both runners first load `tests/isolated-host.ts`: Bun through the `preload` in `bunfig.toml`, Node through an import in `scripts/test.mjs` whose environment the test processes inherit. It points `CODEX_HOME` and `CLAUDE_CONFIG_DIR` at an empty temporary folder, so a test that asks for `health` never reads the Codex or Claude Code transcripts of the machine it runs on. A test that needs transcripts writes its own and points the variable at them.

`test:node` runs Node's test runner over the same files in two passes. The files that do not start Git run first, at most half the machine's threads at a time: every file at once pushes the timing-tight tests past their limits. The files that start Git (any test file whose source names `'git'`) then run one file at a time, because several Git fixtures that clone, commit and merge at once slow each other past their test time limits on Windows. The exit code is a failure when either pass fails.

The offline suite covers routing, lifecycle recovery, parallel ownership, review coverage, context isolation and startup preflight. Latest development check, 2026-10-11: 410 Bun tests and 421 Node tests (including nested cases) passed. Live probes above are historical development observations, not offline-suite requirements or general model-quality claims. Raw development artifacts and review reports are not distributed.

From the repository root, build the standalone viewer with `bun design/build.ts` or `node design/build.ts`. DESIGN.html is shipped; design/viewer.generated.js is an ignored intermediate.

Startup preflight cannot grant network access or authorize project-data export. Previously accepted historical runs are not retroactively re-reviewed by the coverage gate.

Execution authorization rejects plain claims and consumes a fresh matching worker route or scoped single-use host exception. This is an authorization gate, not proof that a model actually performed edits. pi records its process/session evidence; native execution and explicit user instructions remain trusted host attestations. Arbitrary host filesystem edits are outside this runtime boundary.
