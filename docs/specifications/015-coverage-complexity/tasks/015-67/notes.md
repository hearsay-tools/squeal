# 015-67 notes: an exclude change and a move in one pass tell the change once

Worker e6a4deab, 2026-10-26. Brief: `tasks/wave-13.md` W1. Shape: repair. Starts from main 0.1.341 (`081ab75c6`). Findings: `reviews/0.1.341.md` B2 and N1.

## B2: the defect

`moveChecks` (`src/core/code/crap/checks.ts`) removed the `crap` and `uncovered` states of every move destination that the current `coverage.exclude` matches. In a pass where the exclude gains `src/gen/**` and a function moves into the existing `src/gen/b.ts`, the move removed all of `b.ts`'s coverage states. Then `applyChecks` found no states in `b.ts`, counted 0 files, and wrote no change record. The states were right; the summary line was missing.

## The rule and its one owner

**Rule.** The step's `applyChecks` is the one owner of leaving a file out: it removes a newly excluded file's coverage states and counts the file. The move removes the coverage states it brings into an excluded file only when that file held no coverage state before the move. A file that still holds coverage states is one `applyChecks` has not left out yet, so the move leaves the moved states there too, and `applyChecks` removes them with the file's own and counts the file once.

Both decisions read one fact through one helper, `withStates(store, worktreeId, paths)`: the files of `paths` that hold a coverage state. `applyChecks` counts exactly those files (`removeChecks`' `had`). The move adds coverage states only to a file that is in that set already. So a move never changes the count of the summary line.

**Cost.** One `states.list` of the move destinations that the exclude matches, before the moves. With no exclude, or no move into a matched file, there is no read. No scan of every state.

### Why not the brief's first edit

The brief's first edit was: the move removes coverage states only where the summary's exclude (`readSummary(...).exclude`) already matches. I tried it and rejected it, for three reasons:

1. **The summary's exclude lags.** `applyChecks` leaves the files out at once, but the step writes the new exclude into the summary only when it judges, after the seed and the loader map. A step that returns `reading` or `seeding` leaves the old exclude in the summary. A move into the newly excluded file in that window keeps its coverage states, because the old exclude does not match. The next step then counts the file a second time, and the session gets a second "1 file no longer checked" line. The new test `does not count the file again for a move into it before the step writes the exclude` fails with that edit: the second move leaves `crap` and `uncovered` in `src/gen/b.ts`. It passes with the chosen rule.
2. **No summary during coverage's start.** While coverage's first seed runs, there is no summary, and the step does not call `applyChecks`. With "the summary's exclude" as the test, a move into an excluded file during the start seed would keep its coverage states, and no later step would remove them: B1 again.
3. **A pattern taken away.** When the exclude loses a pattern, the old exclude matches a file that the new one does not. The edit would remove the coverage states of a function moved into that file, which is checked again. The chosen rule never removes states from a file that the current exclude does not match.

### What still holds

- B1 (`reviews/0.1.337.md`): an excluded file that `applyChecks` left out, or that was always excluded, holds no coverage state, so a move into it removes the moved states quietly, as before. B1's tests pass without change.
- A move into a new file that the new exclude matches is quiet. The file holds no coverage state, so `applyChecks` would not count it, and it was never checked.

## N1: a function moved out of an excluded file

A function that an edit moves from an excluded file into a checked one has no coverage state to take over. D9 (**First judgement**) makes a first judgement quiet only for a seed: coverage's start, a recount, and, by D1, a check switched on or a file no longer excluded. A move out of an excluded file is none of these. The edit brings the function under the checks, so the step judges it as a function the edit added. A failing one is a first-seen fail, and the session is told. Its complexity state moves with it (D2), so its complexity is not told. The test pins this through both edit paths. No code change was needed.

## Tests

`test/code/crap/excluded-move.test.ts`:
- `a move into a file the same pass's coverage.exclude change leaves out (review 0.1.341 B2)`:
  - `through the edit pass` and `through the staged edit pass` (`partFiles: 1`): the review's probe. Before the move, `src/gen/b.ts` has its three states. After it, complexity only for both functions, a change record with `excluded: 1`, the line `Coverage checks changed: 1 file no longer checked (coverage.exclude).` told once, and nothing told at the next step. Before the fix both failed with `expected null to match object { off: [], excluded: 1 }`.
  - `does not count the file again for a move into it before the step writes the exclude`: the step reads the loader map over several steps, so the summary keeps the old exclude after `applyChecks`. A second move into `src/gen/b.ts` in that window removes its coverage states quietly, and the session is told nothing more.
- `a function moved out of a file coverage.exclude matches (review 0.1.341 N1)`, through both paths: the move keeps the complexity state's `changedAt`. `crap` and `uncovered` get `first-seen-fail`, and the session is told both FAIL lines.

## Residue

- **Not about moves, not probed.** When `coverage.exclude` changes while coverage's start seed runs (no summary yet), the old seed may already have written `pending` states into a file the new exclude matches. The daemon drops the seed on a checks change, but the step calls `applyChecks` only once a summary exists. So those states can stay in an excluded file. I found this by reading `step.ts` and `pass/index.ts`. I did not write a test for it. With this row, a move into such a file also keeps the states it brings, where 0.1.341 removed every coverage state of that file.
- No store, schema, key, text or type change. `PassContext.coverageExcluded` stays and is still used.
