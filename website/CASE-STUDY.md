# Case study data: how Amaleh built this website

This file is the single source for every figure the website states about the runs that built it.
The `/case-study/` page and the landing page quote these figures; they never compute or restate
them from anywhere else. The figures were read from the run records under `.amaleh/runs/` on
2026-09-23 with the `health` and `status` operations and the review artifacts.

## The two runs

| Run | Tasks | Model calls | Independent reviews | Blocking review findings | Check runs | Failed check runs | Worker and reviewer cost estimate |
|---|---|---|---|---|---|---|---|
| `website-visuals` | 6 | 32 | 18 | 11 | 61 | 2 | 1.04 US dollars |
| `website-polish` | 11 | 124 | 56 | 34 | 209 | 9 | 6.78 US dollars |
| Both runs | 17 | 156 | 74 | 45 | 270 | 11 | 7.82 US dollars |

- Cost is pi's local estimate of the worker and reviewer calls, not a billed figure. The
  coordinating host model's usage is not in it. Every time the figure is shown, say "estimated"
  and say that it is worker and reviewer spend.
- A blocking finding is a defect an independent reviewer from a different model family refused to
  accept. Every one of the 45 was repaired before the chunk merged.
- Workers asked Jev for an in-task decision 27 times without the coordinator (3 in
  `website-visuals`, 24 in `website-polish`).
- Models that did the work: DeepSeek (`~deepseek/deepseek-flash-latest`), GLM
  (`~z-ai/glm-flash-latest`), Solar (`upstage/solar-pro4`), MiMo (`xiaomi/mimo-v2.5`) and Kimi
  (`moonshotai/kimi-k3`). Kimi handled escalated repairs.
- In `website-polish`, workers cost an estimated 4.47 US dollars over 57 calls and reviewers an
  estimated 2.31 US dollars over 67 calls.

## Defects independent review caught before merge

Quoted in substance from reviewer findings. Each was blocking, and each was fixed inside the chunk.

1. **Hero, reduced motion.** A visitor who prefers reduced motion and has WebGL would have seen a
   permanently blank hero, because the accessible fallback was hidden while the canvas drew nothing.
2. **Hero, animation.** The coordinator, worker and reviewer nodes disappeared almost immediately in
   the live animation in every WebGL browser, so the hero no longer showed the workflow it exists
   to show.
3. **Docs navigation.** At desktop widths the "On this page" list appeared twice on every
   documentation page, and at 320, 390 and 768 CSS pixels it was missing entirely.
4. **Pronunciation trap.** Three source files carried the wrong pronunciation and the static checker
   asserted the wrong value, so correcting the sources would have broken the checker.
5. **Install on phones.** At 320 CSS pixels the Credentials chip overran its card and the whole
   landing page scrolled sideways.
6. **An ungated rule.** The new two-column limit for prose cards was written into the design system,
   but the checker never ran it, so continuous integration would have passed a page that broke it.

## Honest limits in the same records

- The coordinator took over implementation where the cheap-model loop could not finish: 9 host
  exceptions were granted in `website-polish` and 1 in `website-visuals`. Each is recorded with its
  reason; none is hidden.
- `website-polish` closed with 3 delegation-health warnings acknowledged: the coordinator made 35
  worker, reviewer, repair and accept calls by hand; 23 invalidations reopened delivered chunks
  because their own checks could not see the defect; and Kimi took 35% of the estimated spend.
  Those warnings are why the runtime now refuses to finish a run while any warning stands, and why
  reopening a chunk now requires registering the probe that found the defect.
- Kimi, the deeper repair model, took the largest single share of `website-polish` spend: an
  estimated 2.38 of 6.78 US dollars.

## Images of the skill's own output

- `public/case-study/status-report.png` — `status` for `website-polish`, the readable terminal report.
- `public/case-study/health-report.png` — `health` for `website-polish`: delegation health, model
  speed per role and estimated spend by model.

Both show the text the skill printed for `website-polish` on 2026-09-23, framed as a terminal
window, with the command and the state folder under their current names (`amaleh/scripts/run.ts`,
`.amaleh`). The model speed table is the one printed that day; `health` now counts every call
since, so a fresh run prints larger counts there. Alt text states what each shows.
