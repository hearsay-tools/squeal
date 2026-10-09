# 001-194 notes: a file's keyedAt is the earliest unresolved re-key

## Seam map

- `FileState.keyedAt` and `FileState.lastKeyedAt` (`src/core/scheduler/files.ts`): the earliest and the latest revision whose change moved the file's key with no result at the key since. Written only through `noteKeyedAt` (from `Ledger.settle` with `SettleOptions.keyedAt`) and cleared only through `clearKeyedAt`.
- Cleared in `Ledger`: `applyResults` at the file's current key (a run's result or a lookup hit), `markUnknown` at the current key (crash, timeout, blocked runner, `MAX_DISCARDS`, environment growth's three-in-a-row), and `settle` when the key moves back to the key that has its result or its unknown. Results at an older key (a tier whose file was re-keyed during its run) clear nothing.
- `Scheduler.rekeyedSince` names a file at each of the two revisions in its window; the CLI's `editWindow` dedups by `testFileId`.

## Why two revisions, not one

The brief asked for the earliest only. With only the earliest, a slow file still running from an earlier edit is attributed to that edit's revision, which a later environment edit's wait counts as told, and `editWindow` drops told slow files: the wait named 1 file instead of 2 (`test/integration/status-wait-edit.test.ts`, the environment step). The latest keeps every later window's naming as 001-186 had it; the earliest closes B1. A pending file is held in any window through the earliest and 001-191's told-and-unseen rule.

Remaining gap: a revision strictly between the earliest and the latest that also moved the file is not named on its own. Only a window bounded inside that range misses it, and only for naming a file it does not hold (a pending one is held through the earliest, as above).

## Out of order settles

A revision's refinement can settle after a later revision's content re-key. `noteKeyedAt` takes the minimum, not "set only when null", so the refined revision still becomes the earliest. For 003-45's growth settle, which passes `ledger.revision.number` (never below a recorded revision), the two rules agree.

## Re-review 003-46's completed-sibling case

`test/scheduler/environment-growth-siblings.test.ts`, through `waitForStatus` on the real scheduler and node:test adapter: at 0.1.85 alone the wait at revision 2 ended quiet with 0 files while a and c re-ran; here a's and c's results had cleared their `keyedAt`, so 003-45's growth settle (null takes `ledger.revision.number`) gives them revision 2, and the wait names 2 files and holds until both results. b's own re-run result landed before the wait, so b holds nothing and is not counted. The node:test re-runs after a growth go out as a backlog tier: the test sets `backlogTierSize: 1` and makes a and c slower so b's re-run runs first.

003-45's split in `recordTier` settles a file with a non-null `keyedAt` without `keyedAt`, so a growth does not advance that file's `lastKeyedAt`. A wait covering only the growth's revision then names such a file only through 001-191's told-and-unseen rule (it is pending). Passing `keyedAt` for every moved file would be the same for `keyedAt` (minimum) and would advance `lastKeyedAt`; left alone, as the brief asked.
