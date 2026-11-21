# Row 018-70 notes: the reader looks again, and imports again after the closures

Worker 893a6fd4, 2026-11-21. Brief: `tasks/wave-23.md`, section 018-70. Research: `research/issue-261-ci-import.md` Q2, Q5 options 1 and 2.

## What changed

- `shared.lookAgain` (`src/core/types/policy.ts`, `src/core/daemon/policy-shared.ts`): `everySeconds` (positive whole number, default 30) and `forSeconds` (whole number ≥ 0, default 600). A wrong value is one problem, and its default applies. README, "Results from CI", step 2.
- `src/core/shared/look-again.ts`: `LookAgain`, the timer and window of one start point. `closuresStored` polls the worktree's refined revision (`scheduler/refined.ts`).
- `src/core/shared/reader.ts`:
  - Option 1. While the start point's own ref is not listed, the reader lists again on the timer. A failed listing counts as a miss; its note comes only at the first look. A look again asks only for the start point's own export. An older export still stands in at the first look, as before. The timer stops when the start point moves, when the export is held, or when the reader closes. Its last look is at the window's end. One note when the window ends: `CI results: <remote> had no <ref> after <10 min>; tests run here as before`. `forSeconds: 0` is one look, as before, with no note.
  - Option 2, the coordinator's choice C (request 27077039). The import lands at once, as before. If the worktree's latest revision was not refined at that time, the reader waits until it is refined and imports the same export again. That second import re-keys the files whose closure gained a path. Re-importing is safe: the import record is `ON CONFLICT DO NOTHING`, and a key that holds results keeps them.
- No daemon line changed. The daemon already nudges the reader after each batch and closes it at shutdown, which also cancels the timer. The timer is `unref`ed.

## Why not wait before the import (the first build, e4a369415)

The first build made the import wait for the refined revision. In the scheduler fixture, the catch-up tier starts in the same turn the refinement commits, before the reader's next poll. So f00 still ran (3 of 3 without a backlog hold). In a real daemon, the early import lets the refinement adopt about 1,195 files before the first tier (research Q2, scenario A). The wait could let a first backlog tier (up to `runner.backlogTierSize`, 200) start before the import, so more files could run than today. Option C keeps the early import.

## Proposed follow-up (option B): re-key over the union of the lists

C still races the first tier for the files whose closure gained a path: a tier that starts between the refinement and the second import runs them. B closes the race at the first import. In `rekeyFiles` (`src/core/store/transfer-rekey.ts`), the change replaces the `holdsEvery` skip with a key over `union(stored list with observed, exported list)`. The union never drops an exported input, so review wave-5 B1's concern still holds. After the pull's refinement, the local list usually equals that union. When it does not, the key does not match, and the file runs, as it does today.

Local evidence (not committed): with B and the early import only (no second import, no backlog hold), `test/shared/import-after-closures.test.ts`'s race passed 3 of 3. Four tests in `test/store/transfer-rekey.test.ts` failed (`re-keying keeps every input the exported run read (018 D11, review wave-5 B1)`): "keeps the exported key over an empty observed entry", "over an observed entry disjoint from the export's", "over a list without a static input the export keyed", "over an observed entry without a listing the export read". They pin today's D11 rule. B needs a D11 amendment, and those four cases must be designed again: the observed-entry cases involve listings and directories, not only paths. The prototype joined only paths.

## Tests

- `test/shared/reader-look-again.test.ts` (scratch bare remote; each listing and fetch counted by an `uploadpack` wrapper):
  - a ref published after the move is imported without a restart;
  - `forSeconds: 0` lists once;
  - no listing after the window, and one note;
  - no listing after close, even when the timer fires late;
  - the timer stops when the start point moves;
  - a failed listing is a miss and is noted once.
- `test/shared/import-after-closures.test.ts` (scheduler fixture, 12 files; the pull changes 10, so it is catch-up; f00's closure gains `src/new.ts`; the developer's environment differs from CI's only in `watch`):
  - with the backlog held, f00 ends current from the second import, with 0 runs. Without the second import: 11 of 12 current (red proven);
  - without a hold, only f00 may run, and every file ends current;
  - without any fix, f00 ran once.
- `test/shared/policy.test.ts`: the defaults, partial keys and wrong values.
- Test kit: `shared()` in `reader-kit.ts` defaults to `forSeconds: 0`, so the older reader tests keep one look and start no timer. `readsInput` is exported from `daemon-kit.ts`. The race test gives the reader the scheduler's clock: `readerOf`'s fixed 2025 time stamps imports older than the scheduler's start, so `StoredKeys` never reads them as new.

## For the next worker

- `reader.ts` is about 390 lines, over the about-300 guide. A later split could move `#take` and `#import` into a module of their own.
- `plugins/claude-code/dist` and the other bundles are not rebuilt (the brief forbids `pnpm run build` in a worker tree). The bundle drift tests fail until the coordinator builds.
