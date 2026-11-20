# 011-419: the stuck-file rule counts from the tier's last progress

Worker 47956aef, wave 125 W3, 2026-11-20. Shape: repair. Source: `research/run-width-design.md` section 3 and recommendation 3.

## Change

- `src/core/scheduler/tiers.ts`: `Tier.lastEnded?: { at, step }` (additive, mutable). `executeTier`'s `fileEnded` sets it each time the runner names a file ended: the scheduler's clock, then the calendar steps' total, read in that order as at a tier's start (`newTier`).
- `src/core/scheduler/overrun.ts`: `reportedOverrunAt` counts the threshold from `lastProgress(context, tier)`, the later of the stepped start and the stepped last end (`Tier.lastEnded` moved by `CalendarSteps.since`). The threshold itself is unchanged: `max(10 × last-known time, 60 s)` of each unfinished file, the tier's estimate plus 60 s for a file with no known time. `overrunAt`, `overrunLanes`, `nextOverrun` and `Overruns` read it through `reportedOverrunAt`, so admission, the wake and the published row all follow.
- The published overrun's `startedAt` (status's age, `ranMs`) and `deadline` still count from the tier's stepped start: the file has been in a running tier since then, and the deadline is `runner.timeoutMs` from the run's start. Only `at` (since when it overruns) moves to the threshold after the last progress. All three stay on one elapsed-time basis (review 0.1.567 B2): each is a stored reading moved by the calendar steps since.
- No change was needed in `yields.ts`, `yield-waits.ts` or the status texts. A file end queues a step (`file-ended`), whose yield check calls `Overruns.check`; a wake armed at the old bound fires early, re-reads the bound and re-arms.

## Behaviour change to note

A published overrun is withdrawn when a file of the tier ends: `Overruns.check` reads a bound later than now and deletes it, so status stops saying "may be hung" for that tier until no file has ended for the threshold again. A tier already started beside it runs on; the lane opens no third instance (row 011-405 unchanged).

## Tests

- New `test/scheduler/overrun-progress.test.ts`, each red on the code before this row (all three: a beside run or an overrun published at 60 s from the start):
  1. A 60-file tier (5 ms last time, so the threshold is the 60 s floor) whose files end every 5 s for 120 s: no beside run and no published overrun at any step.
  2. A tier of 4 whose three mates end at +50 s: nothing at +109.999 s; at +110 s a beside run starts and the overrun is published with `startedAt` the tier's start and `at` = last end + 60 s, naming H only.
  3. As 2 with the calendar set back 1 h after the last end: the overrun comes at the same elapsed time, `at` = last end − 1 h + 60 s. Without stepping `lastEnded`, the bound would sit 1 h ahead.
- The 011-399 and 011-405 tests needed no change: their fake runner names no file ended, so their tiers' last progress is their start and every expected age and time stands.
- `reportsEnds` moved from `tier-yields-named.test.ts` to `tier-yields-fixture.ts` (exported, unchanged) so `overrun-fixture.ts`'s `hungTier` can report file ends; `hungTier` gains an optional `tierSize` (default 4) and returns `end`.

## Proposed spec text (the coordinator lands it)

**C4 step 5**, in the 011-399 amendment, replace "overruns when every file of it that has not ended has run 10 times its last-known duration and at least 60 s (a file with no known duration: 60 s past the tier's estimate, its longest last-known duration). The time counts from the tier's start moved by the calendar steps since (row 011-377; review `reviews/0.1.567.md` B2)." with:

> overruns when no file of it has ended for 10 times the last-known duration of each file of it that has not ended, and at least 60 s (a file with no known duration: 60 s past the tier's estimate, its longest last-known duration). The time counts from the tier's last progress, the later of its start and the end of its last ended file, each moved by the calendar steps since (row 011-377; review `reviews/0.1.567.md` B2). Amended 2026-11-20 (the human; row 011-419, `research/run-width-design.md` section 3): counted from the tier's start, files of a narrow tier that had not started looked hung 60 s in, and tiers opened beside backlog tiers in 9 of 10 runs. A tier whose files keep ending does not overrun; when a file of an overrunning tier ends, it overruns no more until no file has ended for the threshold again.

**C6** (the 011-399 line, after "C15 gives the line and its fields."):

> Amended 2026-11-20 (row 011-419): a file is reported as overrunning only while no file of its tier has ended for the threshold (C4 step 5); a file end withdraws the report. Its age and deadline still count from the tier's start.

**C15** (the 011-399 amendment, optional, for consistency): after "Its age and deadline count from the tier's start moved by the calendar steps since", add "; since when it overruns counts from the tier's last progress (C4 step 5, row 011-419)".

## For the next worker

- `Tier.lastEnded` is the only new state, set from `RunOptions.fileEnded` (Vitest's `onTestModuleEnd`). A tier whose runner does not cancel a run never overruns (`cancels`), so its value is not read there.
- The rule still does not know when a file started. Recommendation 3's other half, "or once Vitest names a file's start", is not built: Vitest's `onTestModuleStart` would let the threshold count per file. Not needed for the false positive measured in section 3.
