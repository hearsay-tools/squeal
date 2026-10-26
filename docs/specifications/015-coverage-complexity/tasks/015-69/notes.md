# 015-69 notes: a change of the checks during coverage's first seed leaves no pending state behind

Worker a89b5258, 2026-10-26. Brief: `tasks/wave-15.md` W2. Shape: repair. Starts from main 0.1.349 (`b61615309`). Finding: `reviews/0.1.345.md` N2, from `tasks/015-67/notes.md` Residue.

## N2: reproduced

The case occurs. A test (`test/code/crap/excluded-start.test.ts`) builds it with `rig.ts`:

1. 34 counted files, `src/a.ts` and `src/gen/b.ts` among them, all loaded and run by one test file. Coverage's first step seeds one unit of 32 files and returns `seeding`. There is no summary. `src/gen/b.ts` holds `crap pending` and `uncovered pending`.
2. `coverage.exclude` gains `src/gen/**`. The daemon drops the seed (`pass/index.ts` `checksOf`); the test does the same with `cache.dropSeed()`.
3. An edit moves `made` from `src/a.ts` into `src/gen/b.ts`. The test runs the edit pass with the new exclude and follows its report into the step cache, as `coverageStep` does.
4. The chain ends.

Before the fix, `src/gen/b.ts` kept `crap pending` and `uncovered pending` for `stay` and for `made`, after the chain ended and the summary held the new exclude. Both orders failed: the move in the edit after the exclude change, and the move while the new seed runs.

**Why.** `runCoverageStep` calls `applyChecks` only when a summary exists, and the first summary is written by the first step that walks, after the seed and the loader map. The new seed skips the excluded file, the walk does not judge it, and the summary it writes holds the new exclude. From then on `applyChecks` sees no exclude change, so nothing removes the states. In order 3 before the next step, `moveChecks` also keeps the states the move brings, because the file still holds some (015-67's rule).

**The same window for a check switched off.** I probed it with the same rig: `crap.enabled` off after the first unit. Before the fix, 32 `crap pending` states stayed, one per function the first unit seeded. It is the same gap in the same owner, so the fix covers it.

## The fix

`leaveOutSeeded(store, worktreeId, checks, files)` in `src/core/code/crap/checks.ts`, beside `applyChecks`, with the same `withStates`. It removes every state of a check switched off, and the `crap` and `uncovered` states of the files `coverage.exclude` matches that hold some. It writes no change record and no summary: no file was judged yet, so none was told.

`beginSeed` in `step.ts` calls it when there is no summary, so once each time a start's seed begins: at coverage's start, and again after the daemon drops a seed for a change of the checks. `judgedFiles` takes the files `beginSeed` listed, so the start reads the file list once, as before.

- Order 3 before the next step: the move keeps the states in `src/gen/b.ts`, and the new seed's begin removes them with the file's own.
- Order 3 while the new seed runs: the new seed's begin already removed the file's states, so the file holds none, and `moveChecks` removes the moved states quietly (B1's rule).

**Cost.** With no exclude and both checks on, nothing. Otherwise one transaction per seed begun with no summary: a `removeMeasure` over the worktree for each check off, and one `states.list` of the excluded files. No per-step read.

**Why not `applyChecks` with no summary.** `applyChecks` compares the policy with what a summary was judged with, records the change and writes the summary. With no summary there is no "was" to compare, and nothing to record. Calling it at each step would read the excluded files' states every step of a start. The new function takes the one part that applies, through the same helper.

## Tests

`test/code/crap/excluded-start.test.ts`, all three red before the fix (direct run with the source reverted: `3 failed (3)`), green after:

- `an exclude added while coverage's first seed runs (review 0.1.345 N2)`:
  - `... with a move in the same edit, quietly`: `src/gen/b.ts` holds `complexity pass` twice, `src/a.ts` is judged, the summary has the exclude and no entry for `src/gen/b.ts`, no change record, and S1 is told nothing.
  - `... with a move while the new seed runs, quietly`: the same, with a sliced step of the new seed before the move.
- `a check switched off while coverage's first seed runs`: no `crap` state anywhere, the summary judges `uncovered` alone, no change record, nothing told.

B1, B2 and N1 of `excluded-move.test.ts`, `checks.test.ts`, `seed.test.ts`, `step.test.ts` and `validity.test.ts` pass unchanged.

**Test residue.** A step clock that charges the whole budget at every `now()` call makes the walk judge no file: each step does one unit, and a file needs more than one. Slice only the steps that must be sliced; the test's `finish` step charges nothing.

## Input to the coordinator

- D9 **First judgement** could add: "A start's seed with no summary first removes the pending states that a seed dropped for a change of the checks wrote, of a check now off or in a file now excluded, with no change line (015-69)."
- No store, schema, key, text or type change. One new export, `leaveOutSeeded`, in `checks.ts`; `crap/index.ts` does not export it.

## Residue, not probed

- **Coverage switched off during the first seed.** `clearCoverage` (`removed.ts`) returns at once when there is no summary, so a dropped start seed's pending states stay while coverage is off. When coverage starts again, the start seed judges them or, by this row, leaves them out. I did not check whether status shows them while coverage is off.
- **Both checks off during the first seed.** With `crap.enabled` and `coverage.untested` both off, the step returns before it begins a seed, so `leaveOutSeeded` does not run, and the old seed's pending states stay until a check is on again.
