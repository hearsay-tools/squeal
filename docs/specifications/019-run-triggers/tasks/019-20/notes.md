# 019-20 notes: repair of review 0.1.396 B1 and S4

Worker e98f869f, 2026-11-03. Commits `eb07ed2ea` (B1) and `e48e0adea` (S4).

## B1: a group's load guard wait holds back no other lane

- `SlowTier.next` (`src/core/scheduler/slow-tier.ts`) no longer awaits the guard's sleep loop. `#guard` reads the load once. At or below the bound, or with the pass's budget spent, the file goes on as before (the second case runs under load and adds the note). Otherwise `"held"` when the slot is full (task 004-84), else the lane records `#deferred = { from, lane }`, publishes `{ kind: "waiting", for: "load" }`, arms its recheck at `min(recheckMs, budget left)` and returns `null`. `#groupLanesNext` then asks the next lane. The recheck's pump calls `next` again.
- Budget: `#endDeferral` takes the time since `from` off `#budgetMs`. It runs at the start of every `next` and in `preempt`, which previously aborted the wait. The pass budget and its reset (no file queued) are unchanged, so the default `slow` group keeps `slow.maxDeferMs` per pass and its width rules.
- One lane's selection stays serialized: only the pump calls `next`. The preemption count, the runtime check, `holdCheck`, the slot and `#select`'s hold check are unchanged.
- `GroupTiers.lanes` no longer puts guarded lanes last; that order was the candidate's workaround for B1. It is the policy order now.
- Row 011-211 kept: a lane in its load wait keeps its runner instance. `SlowTier.deferring` gives the runner lane (`laneOf` of the first candidate, which is the tier's lane). `GroupTiers.deferring()` lists them. The scheduler passes them to `SlowRelease` with the lanes in flight.
- `waitForCapacity` (`src/core/slow/guard.ts`) has no product caller now. Only `test/slow/guard.test.ts` uses it. That file is not in this row's ownership; a later row or `/quality` can remove both.

## S4: each lane's instance closes at its own bound

Confirmed before the fix with a fake clock, at the candidate's interface (the host's `endedAt` as the scheduler gave it, the latest end over every group): `slow:vitest` ended at 0, `group:e2e:vitest` ended a tier every 30 s, and nothing was released after 120 s (`expected [] to include 'slow:vitest'`).

- `SlowRelease` (`src/core/scheduler/slow-release.ts`, ownership agreed with the coordinator) records each lane's end through `ended(lane)`. The scheduler calls it at a slow tier's end in place of `arm()`. `arm` sets one timer at the earliest bound of an open lane that is not kept; an earlier bound replaces a later timer. `#due` closes only the lanes past their own bound, then arms again.
- `SlowReleaseHost.endedAt` is optional now: it is the fallback for a lane whose end `ended` did not record. Only `test/daemon/slow-instance.test.ts` still passes it. The scheduler no longer does.
- The shared `selecting` flag stays. A selection is short now that the guard does not wait in it, and its end arms again.

## Tests

- `test/scheduler/group-lanes-guards.test.ts` (new): the review's two-guard case; a second lane that becomes eligible (the load falls below its bound only) while the first stays deferred; a lane whose files a later edit queues while the first stays deferred. All three failed on the candidate.
- `test/scheduler/slow-release.test.ts`: the fixture uses `ended(lane)`. New: a lane closes at its own bound while another lane keeps ending tiers; a lane in its load wait keeps its own instance but not another lane's past its bound.
- `test/scheduler/runtime-gone-slow.test.ts`: the guard now reads the load once (`reads` 1, was 2). The pump's runtime check at the recheck stops the lane before a second read. What the test protects is unchanged: no run, slot, lease or claim.
