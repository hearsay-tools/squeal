# 011-348: a yield asks the tier plan whether the waiting file starts sooner

Worker 5e9336ab, 2026-11-14. Brief: `tasks/wave-95.md` W3. Design: `research/tier-plan.md` decision 2.

## What moved

- `TierYields`' check (`waitedFor` → `sooner`, `yields.ts`) still calls `startsSooner(cut, promoted, marks)`, now from `src/core/scheduler/yield-view.ts`. Only the import changed in `yields.ts`.
- `yield-view.ts` holds `startsSooner`, its input types (`RankedFile`, `AfterCut`, `Promoted`, moved unchanged) and the yield view. `startsSooner` orders the queue after the cut (the cut files that rank before the waiting file by C15's rank, C4's class and last-known duration, then the waiting file, then the other cut files) and asks `planTiers` for the next tier. While the waiting file is not in that tier, it adds the tier's longest last-known duration, takes the tier's files out of the view and asks a new plan.
- `yield-sooner.ts` and `test/scheduler/yield-sooner.test.ts` are gone. Their 7 cases (10 expectations) are rows of `test/scheduler/yield-check.test.ts`.

## The yield view

One lane, the first group only, every file free. The plan forms an edit's tiers: at most `runner.tierSize` files, joined by `joinSpan` with the cut's marks. The view answers:

| Fact | Answer | Why |
|---|---|---|
| `isPromoted` | false | No batch shape: today's model forms an edit's tiers of the cut files. A batch shape (backlog size, grant, one rank per tier) would change the answers. |
| `isFirstGroup`, `hasFirstGroup` | true for queued files | No backlog tier, no turn. |
| `busy`, `turnDue`, `beside`, `slots`, `batchTurn`, focused entries, quiet | none | The plan's other stages stay silent. |
| `tierWidth(ref, grant)` | `grant` | Not read for an edit's tier but by `estimateMs`, which the check does not use. |
| `cut.cutPastEstimate` | the cut's `past` for a cut file, `marks` for the waiting file | As `startsSooner` read them. |
| `file(ref)` | a copy with a placeholder key, no block and no tier cap | The model read none of them. The plan drops an unkeyed or blocked file and caps a tier at `tierCap`. |
| asks | lookup: runs, never waits; held: false; no pool; nothing written | "no saved result, no claim, no pool" (decision 2). |

## Side by side (commit `da4963d76`)

The first commit ran the old model and the plan on the same inputs:

- every case of `yield-sooner.test.ts`;
- the cuts the 4 scenarios of `tier-yields-next-tier.test.ts` describe. In that file the check is never reached: a probe logged 5 calls of `runsSooner`, each stopped by the rank rule (Q's rank 1 is not before the tier's rank 0, row 011-268). So the rows are the cuts its scenarios would ask about;
- 6 new rows: a shared next tier, a cut-marked waiting file that shares no tier, two tiers of 1, and the estimate row below;
- 3,000 seeded cuts (mulberry32, seed 348): 1,348 with a cut file ranked before the waiting file, 800 "no" answers. 0 differences.

A probe over the 15 `tier-yields-*` files and the `promoted-tier*` files logged 97 live calls of the check. In every one no cut file ranked before the waiting file, so the answer is "yes" before the plan is asked.

No case differed. I asked no question about a difference.

## Decisions the spec did not settle, and my choice

1. **The sum counts each tier's longest file, not `Candidate.estimateMs`.** `estimateMs` is `wallEstimate(sum, longest, width)` = `sum/width + (1 - 1/width) × longest`, never below the longest file, and above it when a tier's files differ. Summing it changes answers: the row "the tier ahead counts its longest file, 100 s, not its wall estimate, against 120 s left" answers "yes" with the longest and "no" with the estimate (130 s). I did not change `estimateMs` either: `batchStarted` (`tier-start.ts`) uses it for the batch's estimated end in status, so a change moves a status value. An edit's tier runs each file on its own worker, so its longest file is its wall.
2. **The waiting file's key, block and tier cap are not read**, as the model did not read them (table above). The view hands the plan a copy of each `FileState`. A view of the whole live queue (the later rule change) should read them.
3. **The short path stays:** when no cut file ranks before the waiting file, the answer is "yes" without a plan. It is the answer the plan gives (the waiting file leads the first tier), and every live call in the tests takes it.
4. **A plan that answers `Idle` gives "no".** It cannot happen while the waiting file is queued; the model looped instead.
5. **The seeded sweep is not kept.** With the model gone it has nothing to compare against. It ran in commit `da4963d76`.

## Type changes

- Moved: `RankedFile`, `AfterCut`, `Promoted`, `startsSooner` from `yield-sooner.ts` to `yield-view.ts`, unchanged.
- Removed: `yield-sooner.ts` (its private `Requeued`, `takes`).
- No change to `tier-plan.ts`, `tier-width.ts` or W2's files.

## Tests that name what this change removes

None matches a stack frame or a function this change removes (grep of `test/` for `stack` with these names). Comments still name the old file: `tier-yields-next-tier.test.ts:21` ("`yield-sooner.test.ts` covers that later tier"), which I may not edit (brief: every `tier-yields-*` file unchanged). Its rows now live in `yield-check.test.ts`. `promoted-tier-bound.test.ts:26` names `startsSooner`, which still exists.

## For the next worker

- The yield view is private to `yield-view.ts`. A view of the whole live queue would replace `yieldView` with the live adapter (`tier-live.ts`) over the ledger plus the cut, and table asks that write nothing; it changes when tiers yield (decision 2, a rule change for the human).
- If `Candidate.estimateMs` should be the sum's unit, it needs an edit-tier rule (longest when the width covers every file) and a decision about `batchStarted`'s status estimate.
