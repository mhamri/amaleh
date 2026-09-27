# Built-in discovery, specification and planning

## Shape every request

Every new request and every piece of feedback is raw material for something better, not an order to chunk. A half-built project does not change this. The user's words give the direction. Your job is to make the result, and the user's thinking, stronger than what they asked for.

Before `start`, and again after every `feedback`, think the request through and record it with `shape`:

- **understanding** — the request in your own words, including what it is for. If you cannot say what it is for, you have a question, not an understanding.
- **gaps** — what is missing for it to work: an unstated state, an audience, a size, a failure path, an asset nobody supplied.
- **pushback** — where the request works against its own goal, or against something already settled. Say it plainly and give the reason. Agreeing to spare feelings is a failure of the job.
- **additions** — what would make it clearly better, and that the user has probably not thought of yet.
- **options** — two to four approaches that genuinely differ, each with what it buys and what it costs, and your `recommendation`. Include the bolder option when one exists; do not list three variations of the same idea.
- **clearCut** — instead of options, only when the request has one sensible reading. A typo fix or an exact instruction is clear-cut. A new section, a redesign or a reaction such as "this does not feel right" is not.
- **mentor** — a principle the user can reuse, written only when their request shows a gap in the principle itself. Example: "A hero earns attention with one promise, not a feature list". Leave it empty when there is nothing to teach. It is a note for a peer, not a lecture.
- **questions** — only what blocks the choice, in one round, with your recommended answer for each.
- **affects** — for feedback, the delivered tasks it reshapes.

Real options or open questions leave the shape open. `next` returns `ask-user`, and `plan`, `amend`, `invalidate` and `delegate` refuse until the user answers. Put them to the user in the same message: the options best first, your pick, and why. Record the answer by running `shape` again with `chosen` quoting the user's words. The chosen option becomes a `requirement` decision, so workers, reviewers and later runs inherit it. A clear-cut shape with no questions closes at once, so small, exact work is never slowed by a conversation it does not need.

Feedback on delivered work is new scope, not a failed attempt. Reopen each task the shape names in `affects` with `invalidate` or `amend` and `"feedback":true`. That reopen spends no repair cycle, so the task is not pushed toward Kimi or host takeover. Each named task can be reopened once per feedback.

## Discover and plan

Start from current code and accepted intent. Use Jev to select proceed, research, focused grilling or brainstorming based on an actual gap. The host communicates with the user; workers gather facts. Ask only prerequisite-ready questions in small rounds, with recommendations and consequences. Show two or three meaningful approaches when there is a real design choice. Preserve answers in run decisions/artifacts; reopen only invalidated choices. Existing authorization and settled answers persist across sessions.

For small known work record the objective, affected behavior, checks and a cohesive task. Every check carries a `role`: `"probe"` detects the task's defect on the unchanged checkout; `"guard"` protects existing behaviour. A code task must have at least one probe, or a `"noProbe"` string explaining why no executable can detect the outcome. Register every probe you will judge the chunk by, before the first delegation: for visual work that means the rendered measurement, not only type check and build. A defect you find after acceptance with a probe the chunk never ran costs a reopen. Do not require separate specs or interviews. For larger work, synthesize an HTML specification with problem, solution, acceptance criteria, user stories, interfaces, implementation decisions, testing and exclusions. This is an internal capability, not an invocation of to-spec. Reflect newly co-designed intent for confirmation before dependent implementation, without repeated artifact approval stages.

Maintain phase outcomes and contracts for the whole feature, then detail ready tasks. Dependencies are actual prerequisites, not phase numbering. Group edits that must evolve together. Allocate ownership/resources. Identify parallel research or work whose inputs are already stable. Expand the graph as real facts emerge while retaining task ancestry and completed evidence. Do not declare a phase complete just because its plan is written.

One task per independently deliverable outcome. A single task carrying three or more run outcomes, or four or more of its own criteria, is rejected by `plan`: nothing in it can run in parallel and one worker receives the whole feature. Split it, or pass `singleChunk` with the reason the work genuinely cannot be divided; that reason is recorded and surfaces in `diagnose`.

A task carries its own binding guidance. `skills` names installed skills or paths to instruction files; `references` names design contracts, style guides or specification files. The runtime reads them at launch and inlines them into the worker's brief, so the coordinator names a skill instead of retyping it. A named skill resolves to `SKILL.md` under the host's skills directory; a path resolves against the task workspace. An unreadable entry fails the launch and names every path it tried, so guidance is never silently missing.

A task that reproduces vendor code or setup for a third-party service needs that vendor's documentation among its `references`: an embed or tag snippet, a vendor call's argument order, the steps in a vendor console. Workers have no web search tool and are forbidden to write such code from memory, and the reviewer blocks any that has no source in the workspace or the references. Save the vendor's page into a file before planning the task, and name that file; otherwise the worker stops with a contract question asking for it.

Later work on an existing outcome continues its run rather than starting a fresh one. `start` with `continues` inherits the prior run's acceptance criteria and every settled requirement decision, so an accepted palette, contract or interface is not re-decided from zero. Without `continues`, `start` refuses an intent that substantially repeats an existing run and names it; `unrelated` with a reason overrides when the overlap is coincidental.

Human-facing design, specification and graphs use HTML. The host defines their contracts; routed workers author substantial documents and archive them with `save`; `html` produces a current run progress view. Update repository documentation when behavior changes. Run state, not the HTML or chat, determines the next action.
