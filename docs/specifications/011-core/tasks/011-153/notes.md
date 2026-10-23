# 011-153: catch-up of an edit waits for 120 s of quiet

Worker notes, wave 25 (W1), from main `7e585a601` (after 0.1.278). Commits `fab06d900`, `32e00dc02`, `8734a8528` and the later ones the summary lists.

## 1. What changed

- `BacklogQuiet` (`src/core/scheduler/quiet.ts`) holds a second wait per lane, catch-up's, `CATCHUP_QUIET_MS` = 120 s. `caughtUp(lane, now)` starts it. `queued(lane, now)` starts each running wait of the lane again, the 20 s one and this one. `end(now)` (`squeal run --all`) ends both. Each change publishes both (`publish(ends, at, catchUp)`).
- The wait starts in `applyRunnerPart` (`refinement.ts`), right after `demote`: `quietCaughtUp` takes the lanes of the files the cut left catch-up that are queued as catch-up. A lane that runs its backlog in slots (`backlogSlot`) is skipped, so it never waits.
- `selectTier` (`tiers.ts`) asks `quietHolds` for each queued file: in a backlog tier, a lane that waits after a cancel holds every file (011-82, unchanged); in a backlog tier or the second group's turn, a lane whose catch-up waits holds each catch-up file (`ledger.queue.isCatchUp`).
- `quietSleepMs` also wakes the pump at the end of a catch-up wait whose lane has a catch-up file queued.
- The `quiet` meta row gains `catchUp: { lane: end }`, absent with no such wait. `publishedQuiet` still returns the 20 s waits only (the 011-82 tests read it); `publishedWaits` returns both.
- Status: a queued file of a lane with no tier running, not promoted, reads the wait that ends later. When that is catch-up's, the standing carries `quietUntil` and `quietCatchUp: true`, and the line reads `queued: the vitest lane waits for quiet until HH:MM:SS, 120 s after the last edit that queued a file of it, before it runs catch-up: …; squeal run --all ends the wait`. The 011-82 text is unchanged.
- Outside the brief's list, both approved by the coordinator (reply to request `058f0160`): `scheduler.ts` forwards the catch-up ends to `publishQuiet` (one line); `types/standing.ts` gains the optional `quietCatchUp?: true` (additive).
- `SchedulerOptions.busySliceMs`'s comment now says it slices only with `busyWaits` (011-132 slice 4).

## 2. Decisions the spec did not settle

1. **Who starts the wait.** Only an edit whose runner part left catch-up in the lane. A catch-up revision (10 or more keyed paths, as a pull) starts none, so a pull's catch-up runs at once, as the 011-82 test 4a requires unchanged. Any revision that queues a test file of the lane starts a running wait again, a pull's included, as the amended sentence reads ("no revision whose re-key queues a test file of that lane"). A daemon start starts none (`bootstrap.ts` calls neither helper).
2. **A pull's catch-up during an edit's wait is held too.** The queue keeps one catch-up flag per entry and does not record which revision made it catch-up (`queue.ts`, not this row's). While the wait runs, every catch-up file of the lane is held. Telling them apart needs a field on the queue entry.
3. **Which tiers it holds.** The backlog's tiers and the second group's turn: the amended sentence lists the edit's own tiers, a promoted file and `run --all` as not held, and not the turn. An edit's tier still takes catch-up files beside its own (tier sharing, 001-184), as it takes the backlog's during the 20 s wait, so a promoted file's tier does too. Holding them there too would be one more condition in `quietHolds`.
4. **The rest of the second group is not held.** During the catch-up wait a backlog tier takes the baseline's, an environment change's and re-queued files, as the sentence holds only catch-up.
5. **The slow tier waits longer.** It starts once no fast work is pending, the backlog's included (004 D2, 004-60), so held catch-up delays it by up to the wait, as the 20 s wait does.
6. **Status names the later wait.** The store does not tell catch-up files from the rest of a lane's queue, so, as 011-82 does, every queued file of a lane with no tier running reads the wait. With both waits, the later end is the one the catch-up files wait for.

## 3. Spec sentences, drafted

C4 step 5, after "…and status names this wait as the one above (amended 2026-10-23, …)":

> The wait starts when an edit's runner part leaves catch-up in the lane; a catch-up revision starts none, but starts a running one again as any revision that queues a test file of the lane does. It holds catch-up from the backlog's tiers and the second group's turn; an edit's tier still takes catch-up files beside its own (tier sharing), and the rest of the second group runs. The queue does not tell an edit's catch-up from a pull's, so while the wait runs it holds both (row 011-153).

C6, in the `Outstanding:` sentence, after "`--json` gives the end as `quietUntil` (row 011-82)":

> , with `quietCatchUp: true` when it is the wait before catch-up; when both waits run in a lane, the group names the one that ends later (row 011-153)

## 4. Tests

- `test/scheduler/catch-up-quiet-select.test.ts`: `selectTier` with a fake context. No tier of catch-up while the wait runs and one at 120 s; the rest of the backlog runs; an edit's and a promoted file's tiers start; the turn takes the rest and no catch-up; start, restart, end and a pull's revision on `BacklogQuiet`; the published row.
- `test/scheduler/catch-up-quiet.test.ts`: the edit-cut fixture on a scheduler with a movable clock. An edit runs its kept files at once and no catch-up tier until 120 s after the last edit (a second edit 60 s on restarts it); `run --all` starts catch-up at once; a lane of slots never waits.
- `test/status/catch-up-quiet-wait.test.ts`: the line, `quietUntil` and `quietCatchUp` in `--json`; the later of two waits; an ended or a predecessor's wait says nothing.
- The 011-82 tests (`test/scheduler/backlog-quiet*.test.ts`, `test/status/quiet-wait.test.ts`) are unchanged.
