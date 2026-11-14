# 011-346: the tier plan and its act step, behaviour preserved

Worker d2588e46, 2026-11-14. Brief: `tasks/wave-95.md` W1. Design: `research/tier-plan.md`.

## What moved

`selectTier` (`tiers.ts`) is now a wrapper: `startNext(context, ledger, planTiers(liveView(...), liveAsks(...)))`. It has no self-call and no sixth parameter; `SelectPass` is gone.

| File | What it holds |
|---|---|
| `tier-plan.ts` | The types (`QueueView`, `PlanAsks`, `Candidate`, `GrantAsk`, `Idle`, `TierPlan`, `Outcome`), `planTiers`, the stages (free lanes, beside, slot) and `idleOf`. |
| `tier-pass.ts` | One pass: `selectTier`'s body as a generator. The six self-calls are `yield*` of a new pass. `candidateOf` and `batchTurnDue`. |
| `tier-pick.ts` | A pass's shape (batch, backlog, turn, size, offer, budget) and its pick loop; `batchFiles` (moved from `promoted-tier.ts`). |
| `tier-focus.ts` | The focused stage (`focusedCandidate`, `turnFirst`), moved from `focused.ts` (parent's grant, request ee29a61e). |
| `tier-width.ts` | `widest`, `fewest`, `grantFit` (the pure `atGrant`), `narrowerThanEdit`, `estimateMs`. |
| `tier-live.ts` | `liveView` and `liveAsks`: the daemon's adapters. |
| `tier-start.ts` | `startNext`, the act step, and `batchStarted`. |

The plan is a generator. A pass yields a candidate and receives the act step's outcome (`started`, `refused`, `unstarted`). The six self-calls are now `yield*` of a nested pass, in the same places. So the order of reads and writes is `selectTier`'s, line for line. Self-call to pass:

| Former line | Now |
|---|---|
| 284 | `pass` → nested pass, origin `turn-after-batch`; a `null` return goes on, as before |
| 418 | `endPass()`, then a pass with `turnDue: false` |
| 423, 435, 461 | `afterRefusal("pool" or "narrower")` on a batch → `endPass()`, pass with `asEdit` (`batch-as-edit`) |
| 440 | `afterRefusal("pool")` on a turn → `endPass()`, pass with `turnDue: false`; else idle |
| 491 | empty batch pick → `endPass()`, pass with `wide: false`, origin `after-claims` |
| 496 | `afterUnstarted(files)` with a settled pick, or slots → `endPass()`, the same pass again |

The pump's `selectTier(...) ?? #besideTier(...)` and its slot loop are gone. `#plan` builds one plan per lock turn. The stages: the free lanes; when they start nothing, the beside pass (`view.beside()` is `besideFiles`, read at the same moment as before); after a slot starts, the next selection (`view.slots`; `view.busy()` reads `#busyLanes()` again after `#fly`, as the loop did).

## Each write and its transaction

The plan writes nothing itself. Every write goes through `PlanAsks` (live adapter in `tier-live.ts`) or the act step, at the point where `selectTier` made it.

| Write | Where | Transaction |
|---|---|---|
| `Claims.begin()` (memory flag) | `asks.beginPass()`, once per pass, after the focused stage and the post-batch turn | none (memory) |
| `FocusedEntries.waiting(now)` prunes entries past their deadline (memory) | `asks.focusWaiting(now)`: the focused stage, and the pick's `focusWaits` | none (memory) |
| `FocusedEntries.drop(entry)` (memory) | `asks.dropFocus(entry)`: the focused stage, an entry that may not run | none (memory) |
| `Claims.holds` sets `#seen` and `#waiting` (memory) through `peekClaim` | `asks.peek(ref)`: `turnFirst` | none; `peekClaim` reads the store (`results.byKey` with `usedAt` 0) |
| `RunQueue.remove(ref)` and `Ledger.touch(file)` | `asks.drop(ref)`: an unlisted, unkeyed or blocked file | memory; written at the next `Ledger.commit` (an `endPass` or `startTier`'s) |
| `Ledger.probe` → `results.byKey(key, now)` updates `last_used_at`; `copyReadAsOne` may copy a set (`copyNewest`) | `asks.lookup(file, key)` | each its own statement, outside any transaction, as before |
| `Ledger.applyResults` on a hit | `asks.lookup` | memory; written at the next commit |
| `Claims.holds(key, now)` sets `#seen` and `#waiting` | `asks.held(key, now)` | none (memory) |
| `TierCapacity.offer` (reads permit files and `/proc`) | `asks.offer(want, kind)` | none |
| `Ledger.commit()` | `asks.endPass()`: line 418, every refusal (pool and narrower), after a pick that started nothing | the commit's own transaction, as before |
| `TierCapacity.take` (permit files; `PoolWaits` told) | act step | pool files, as before |
| `lease.release()` | act step: a narrower grant (before `endPass`), and in `finally` until the tier owns the lease | pool files |
| `startTier`: `startable`'s re-probe, `applyResults`, `queue.remove`, `claims.taken`, `setRunning`, `runs.start`, `commit` | act step | `BEGIN IMMEDIATE` (`store.transaction`), unchanged |
| `startFocusedTier`: `newTier`, `writeFocused`; then `focused.started`, `focusedSelected` | act step | `store.transaction`, unchanged; then memory |
| `batchStarted` (`batchSelected`, `batchStarted`) or `tierSelected(tookBacklog)` | act step, after a start | memory, as before |

Order of a refusal with a lease, as before: `release()`, then `endPass()` (commit), then the next pass. Order of a start that started nothing: the lease's `release()` in `finally`, then `endPass()`.

## Clock readings

- **One reading per plan.** `QueueView.now` is read once when the plan is made. Before, each recursive `selectTier` call read `context.now()` again, and so did `holds` (its default), `turnFirst` and `selectFocusedTier`. Now the plan passes its `now` to `holds`, `quietHolds`, `focused.waiting`, `rankAt` and `turnFirst`. The difference is the time between two passes in one lock turn: microseconds, or one `#fly` in the slot stage. Reads that take no `now` parameter keep their own clock: `Ledger.probe` (`acceptedAt`), `peekClaim`, `besideFiles`, `newTier`, `runs.start`.
- **The quiet wake.** Before, the pump read `quietSleepMs(context, ledger)` after `#groupLanesNext`, with a later clock reading. Now the plan computes `quietSleepMs(context, ledger, view.now)` when it ends idle, and the pump sleeps `wakeAt - at`. The pump wakes later by the time from the plan's end to the pump's wake check: milliseconds (an `await` of the slow lanes in between). A queue change in that gap calls `#notify`, so the pump looks again at once, as before.
- When no plan ran (admission answered no fast tier), `#idleNow()` reads the same answer with a fresh clock: today's behaviour.

## Decisions the design did not settle, and my choice

1. **`TierPlan` has `afterUnstarted(files)` and `afterStart(tier)` beside `afterRefusal()`.** A settled pick (line 496) re-plans *the same pass*, not from the top. From the top, the focused stage and the post-batch turn would run again. A lookup that settled a second-group file can turn `turnFirst` from true to false, and the focused tier would then start before the pass, which changes the order. `afterStart` continues the plan only for the slot stage; a non-slot start ends it (`null`).
2. **`Idle.wakeAt` is the reason's own wake, not the earliest of all reasons that hold.** The earliest would change today's waits. Example: claims (1 s or a store move) when a quiet wait ends sooner.
3. **The pump still reads `claims.waiting` and `capacity.refused()` beside `Idle`.** Slow lanes (`selectSlowTier`'s `claims.holds`, `slow-tier.ts:737`), lint parts and local permits set them after the plan. With `Idle` alone, those claim and pool wakes would go. `refused()` also clears the flag, as today's look did. The claim wake fires on `idle.idle === "claims" || claims.waiting`; the pool wake on `refused() || idle.idle === "pool"`. `refused()` is always called there, so the flag clears as before. The quiet wake reads `Idle` only.
4. **`PlanAsks` has more asks than the design's five:** `beginPass`, `focusWaiting`, `dropFocus`, `peek`, `drop` and `claimsWaiting`, beside `lookup`, `held`, `offer` and `endPass`. Each is a write or a read whose answer the table must control. `backlogSize(queued)` replaces `sharers()`: `Claims.backlogSize` keeps its formula in one place.
5. **A slot's width is a grant ask of 1 worker,** as before (a slot takes one permit). It has no separate `"slot"` width.
6. **`Idle` reasons.** `pool` comes from the act step, only after a pool refusal (a narrower grant is not one) and only when neither `claims` nor `quiet` holds. `lane-busy` means a fast file is still queued; otherwise `nothing-queued`.
7. **`Candidate.estimateMs`** is `wallEstimate` at the offer for a granted tier, else at its file count. A focused tier's is 0. 011-348 may want another rule.
8. **`Candidate.counts`:** `"batch"` (`batchStarted` at the lease's grant, else the offer, else the file count for `batch-as-edit`), `"tier"` (`tierSelected(tookBacklog)`), or `"none"` for a tier beside a batch's tier and for a focused tier, which `startFocusedTier` counts itself (`focusedSelected`).
9. **`startNext`'s options:** `check(lane)` before each start (`checkTurn`); `fly(tier)` flies each start and lets the plan go on after a slot. Without `fly` (the wrapper), it returns at the first start. `#fly` still checks the turn as well.

No path needed an order change; I asked no question about an order, a write or a transaction. I found no real bug.

## Type changes

- Removed: `SelectPass`; `selectTier`'s sixth parameter `pass` (no caller outside `scheduler.ts` passed it); `focused.ts` `selectFocusedTier`; `promoted-tier.ts` `batchFiles` and `batchTurnDue` (moved to `tier-pick.ts` and `tier-pass.ts`, not exported).
- Changed: `startFocusedTier` is exported and takes `files: readonly TierFile[]` (the plan builds them); `runnable` (`focused.ts`) is exported; `quietSleepMs` takes an optional `now`.
- Added: everything in `tier-plan.ts`, `startNext` and `StartOptions`, `liveView` and `liveAsks`, `widest`, `fewest`, `grantFit`, `estimateMs`.

## Tests

- New: `test/scheduler/tier-plan.test.ts` (25 cases) over `tier-plan-table.ts` (a `view(rows)` builder and a logging table of asks). It covers each candidate reason, the six former self-calls with their asks in order, 0.1.413 B1's six 500 s files at a grant of 3 (`batch-as-edit`), the trim at a lower grant, quiet holds, slot skipping, `joinSpan` and cut marks, `tierCap`, the lazy lookups (the log stops at the tier's size), the beside and slot stages, and each `Idle` reason with its wake time.
- New: `test/scheduler/tier-start.test.ts` (8 cases), a real `Ledger` and a fake pool: grant, trim at a lower grant, narrower than an edit's (released, next candidate), refusal to the next candidate and the `pool` answer, a claim or quiet answer before the pool's, a lease released on a throw, a settled pick re-planned, `check` and `fly` with the slot continuation.
- Unchanged and passing (direct `vitest run`, see the report): the 7 `selectTier` files, 36 cases.

### Scheduler cases the plan table repeats (for a later quality row)

| Plan table row | Scheduler case |
|---|---|
| 284 turn-after-batch | `batch-select.test.ts` "review 0.1.378 B1: with an edit's work queued too, the tier after the first batch's is the backlog's turn"; `batch-tier.test.ts` "the backlog's turn after a batch's tier ..." |
| 418 focused before a due turn's whole tier | `focused-turn.test.ts` "5d: the turn's tier takes no file whole while its focused entry waits"; `focused-group-turn.test.ts` "a focused tier of a batch while the post-batch turn is due ..." |
| 423 batch refused → as an edit's | `batch-busy-host.test.ts` "with the pool refusing every permit, a 6-file batch starts at once as 4 files, then 2" |
| 461 B1 | `batch-busy-host.test.ts` "a grant the wall budget trims below an edit's tier still falls back to 4 (review 0.1.413 B1)" and "with the pool granting fewer workers than an edit's tier, returns the grant and starts 4" |
| 440 turn refused → edit first | `catch-up-turn.test.ts` "gives way to the edit's tier while the pool would hold it back" |
| 491 after-claims | `promoted-tier-select.test.ts` "with every promoted file claimed, starts as before (C7)" |
| 496 slots after settled edits | `backlog-slots.test.ts` 1; `slots-backlog-turn.test.ts` |
| quiet holds | `backlog-quiet-select.test.ts` "starts no backlog tier in a lane that waits ..." and "takes an edit's file at once in a lane that waits ..." |
| beside | `batch-beside.test.ts` 3 and 5 |
| claims idle | `claims.test.ts` 9 |

## Key format

Unchanged. The plan decides which files start, never a key. `test/keys/validity/` reaches `ledger.ts`, `queue.ts`, `claims.ts` and `promotions.ts`; none of them changed, and the new files are not on the validity path. See the report for `test/keys/key-format.test.ts`.

## For 011-347, 011-348 and 011-349

- **011-347:** `QueueView.ordered`, `orderedBatches` and `rankAt` are the seams. The live adapter calls `ledger.ordered(turn)` and `ledger.orderedBatches()`, which read the clock per promoted entry (`Promotions.rankOf`). Pass `view.now` through them.
- **011-348:** `planTiers` takes any `QueueView` and `PlanAsks`. A yield view needs only the read methods the pass uses. The table adapter in `test/scheduler/tier-plan-table.ts` is a working model. `Candidate.estimateMs` is the estimate to sum. Set `slots` false and `beside()` to `null`.
- **011-349:** the wrapper is `selectTier` in `tiers.ts` (about 10 lines). The 7 files' cases map to the plan table rows above. `tiers.ts` still carries `selectTier`'s long doc comment, which states the rules. Move it to `tier-pass.ts` when the wrapper goes.
- `pickFiles` (`tier-pick.ts`) has complexity 50 (Squeal's count; `selectTier` was 130). Its loop is `selectTier`'s loop unchanged. Splitting it further is a later quality row.
