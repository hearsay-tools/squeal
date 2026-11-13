# Wave 17.5: repair of `cand/0.1.465` (review `reviews/0.1.465.md`: FAIL)

Base: each worker's own branch (the candidate is that work cherry-picked onto main 0.1.464; the coordinator cherry-picks the repair commits onto it). Same check rules as `tasks/wave-17.md`: targeted tests only, no full suite, no `pnpm run build`.

## R1 (row 020-49, B1, blocker)

Use /worker. Shape: repair. Read `reviews/0.1.465.md` B1 and its reproduction.
- The refusal summary counts "run here" as all refusals minus store hits, so a refused file in `notStarted` or `overBudget` reads "run here". Classify each refused file from the final run report: read from the stores; run here (started; a started file that did not finish says so honestly, not "run"); not run (`notStarted`, `overBudget`). Keep one bounded line per reason and the three-name limit.
- First edit, as a lead: `src/core/code/gate/parts-refused.ts:87-90`, the count per class.
Owns: `src/core/code/gate/parts-refused.ts`, `src/cli/code-gate.ts` only where it passes the run report, D13.2's text in your notes, their tests.
Done when (tests): a summary regression with unstarted and over-budget refusals; a CLI regression for the review's spent-before-run case (`--timeout 1`, a config that spends the budget at start); the later-store-hit case and every exit and verdict assertion unchanged.

## R2 (row 020-48, S1, should-fix folded in)

Use /worker. Shape: repair. Read `reviews/0.1.465.md` S1.
- `partsOf` in `src/core/code/gate/keep-sent.ts:180-195` lets one file's reads exceed the 4 MiB bound and leaves the envelope bytes out. Split a large file's lists across entries with the same `ref` (the merge is additive) and count the serialized write as sent.
Owns: `src/core/code/gate/keep-sent.ts`, `test/daemon/keep-seen.test.ts`, their tests.
Done when (tests): every serialized part is at most the bound, at the boundary and for one file larger than it; all three lists and their order survive the merge.
