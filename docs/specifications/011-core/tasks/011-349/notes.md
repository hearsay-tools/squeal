# 011-349: the old tier entry point goes

Worker 23d565cd, 2026-11-14. Brief: `tasks/wave-95.md` W2. Design: `research/tier-plan.md`, "Tests: replace, don't layer".

## What went

- `selectTier` (`tiers.ts`), the wrapper over `startNext(planTiers(liveView(...), liveAsks(...)))`. No caller in `src` was left; `scheduler.ts` did not import it. Its imports of `liveView`, `liveAsks`, `planTiers`, `startNext`, `CutFiles` and `NONE_CUT` went with it.
- Its doc comment, which states the selection's rules, is now the doc comment of `pass` (`tier-pass.ts`), with a new opening paragraph and "Returns the tier that started, or `null`". `tier-pass.ts` is 261 lines.
- Comments that named `selectTier` in my files now name the plan or the selection before it (`tier-live.ts`, `tier-pick.ts`, `tier-pass.ts`, `tiers.ts`).
- **Left for W3 or a later row:** `tier-plan.ts` (lines 16, 81-83, 104) and `yield-sooner.ts` (line 98) still name `selectTier` in comments. They are W3's files. `test/capacity/pool.test.ts:51` and `test/run-evidence/fixture.ts:318` name it in comments; `test/code/`, `test/delivery/` and `test/lint/` use `"selectTier"` only as a fixture function name. None is a call.
- **Tests that match a removed name in a stack or by function name:** `test/scheduler/busy-record.test.ts` (lines 163 and 206) injected a busy write by matching `"selectTier"` in the stack; since 011-346 the pump writes through `startNext`, so two cases time out at this baseline. The parent repaired it on the candidate (c56242d99, `"selectTier"` → `"startNext"`); I did not edit it. `superseded-claim.test.ts` matches `"recordTier"`, which still exists. `test/code/delivery/*` and `test/delivery/hold-code-wait.test.ts` use `TIERS = "src/core/scheduler/tiers.ts"` and `"selectTier"` only as made-up complexity rows (`putFile`, `fnCheck`); they never read the real file, so the removal does not touch them. `#besideTier` and `SelectPass` (removed in 011-346) match nothing in `test/`.

## Where each case went

Files that went whole: `batch-select`, `focused-group-turn`, `promoted-tier-select`, and `batch-busy-host` (it had no quiet-state, publishing or `PoolWaits` case). Files reduced: `backlog-quiet-select`, `catch-up-quiet-select`, `pool-wait`.

A case that checked a sequence of tiers is split: the decision goes to the plan table, what a start counts toward goes to the act tests or to the queue's tests, where the counter lives (`RunQueue.batchSelected`, `tierSelected`, `focusedSelected`). New files and the `queue-promotion.test.ts` cases are the parent's grant (request 631b16dd).

| Old file, case | New file, case |
|---|---|
| `batch-select` "6. a stream of 7 four-file waits ...: a backlog tier follows each batch tier" | `tier-plan-batches` "after a batch's tier, the backlog's turn; with none of the second group queued, the next batch" (the decisions); `tier-start-batch` "a batch's start makes the backlog's turn due; the turn's tier that takes the backlog ends it" (the count) |
| `batch-select` "review 0.1.378 B1: with an edit's work queued too, the tier after the first batch's is the backlog's turn" | `tier-plan` "284: after a batch's tier, the backlog's turn ..." (already there, 011-346) |
| `batch-select` "with no file outside a batch queued, batches follow one another" | `tier-plan-batches` "after a batch's tier ... the next batch" (third table) |
| `batch-select` "a re-wait of files already in a batch forms no batch, and the first keeps its place" | `queue-promotion` "a re-wait of files already in a batch forms no batch, and the first keeps its place" |
| `focused-group-turn` "a focused tier of a batch while the post-batch turn is due: the turn first, then the focused tier, then the turn again" | `tier-plan-batches` "while the post-batch turn is due, the turn goes first; then the focused tier" (decisions; a focused candidate counts `none`); `queue-promotion` "a focused tier of a wait's group makes the backlog's turn due ..." (the turn again) |
| `focused-group-turn` "a focused tier of a group makes the backlog's turn due and counts not toward the four" | `queue-promotion` "a focused tier of a wait's group makes the backlog's turn due ..." and "... counts not toward the four first-group tiers" |
| `focused-group-turn` "a focused entry of no wait's group still counts as a first-group tier (row 011-145)" | `queue-promotion` "a focused entry of no wait's group counts as a first-group tier (row 011-145)" |
| `promoted-tier-select` "takes every promoted file in one backlog tier, and none of the backlog" | `tier-plan-batches` "takes every file of the batch in one backlog tier, and none of the backlog"; its turn after: `tier-plan` 284 |
| `promoted-tier-select` "takes the promoted files free of claims (C7)" | `tier-plan-batches` "takes the batch's files free of claims; the claimed stay queued (C7)" |
| `promoted-tier-select` "with every promoted file claimed, starts as before (C7)" | `tier-plan-batches` "with every file of the batch claimed, the backlog starts in an edit's tier as before (C7)"; asks: `tier-plan` 491 |
| `promoted-tier-select` "the backlog's turn after four first-group tiers does not go before a batch" | `tier-plan-batches`, same name |
| `promoted-tier-select` "with an edit's work queued, the batch still forms one tier (row 011-268)" | `tier-plan-batches` "with an edit's work queued, before or after the wait, the batch still forms one tier" |
| `promoted-tier-select` "a lane that runs its backlog in slots keeps promoted files in an edit's tier" | `tier-plan-batches` "a lane that runs its backlog in slots keeps the batch's files in an edit's tier" |
| `batch-busy-host` "with the pool refusing every permit, a 6-file batch starts at once as 4 files, then 2" | `tier-plan-batches` "refused by the pool, the batch goes at once as an edit's tier of 4, then of the 2 left"; act: `tier-start` "a refusal takes the next candidate ..." |
| `batch-busy-host` "runs the refused batch's tier as an edit's: no grant, its workers stated to the pool" | `tier-start-batch`, same name (start, then `executeTier`) |
| `batch-busy-host` "with the pool granting fewer workers than an edit's tier, returns the grant and starts 4" | `tier-plan-batches` "granted fewer workers than an edit's tier runs with, ..."; act: `tier-start` "a grant narrower than an edit's tier goes back ..." |
| `batch-busy-host` "a grant the wall budget trims below an edit's tier still falls back to 4 (review 0.1.413 B1)" | `tier-plan` "461: review 0.1.413 B1 ..." (already there) |
| `batch-busy-host` "with the pool granting, the batch runs as one wide tier as before" | `tier-plan` "a batch granted what it asked is not narrower ..." and `tier-start` "takes the grant and starts the candidate holding the lease" (already there) |
| `batch-busy-host` "an edit queued after the wait runs after the batch's tier" | `tier-plan-batches` "an edit queued after the wait waits for the batch's tiers" |
| `backlog-quiet-select` "starts no backlog tier in a lane that waits, and one once the wait ends" | `tier-plan-quiet`, "starts no backlog tier while the lane waits, and one of every file once the wait ends" |
| `backlog-quiet-select` "takes an edit's file at once in a lane that waits, and leaves the backlog's queued" | `tier-plan-quiet` "takes an edit's file at once, the backlog's beside it, and leaves the rest queued" |
| `catch-up-quiet-select` "starts no tier of catch-up while the lane's catch-up waits, with no cancel; then one" | `tier-plan-quiet` "starts no tier of catch-up while it waits, with no cancel; then one"; its `quietSleepMs` part stays in `catch-up-quiet-select` as "the pump looks again each second while the lane's catch-up is held, and not once it ends" |
| `catch-up-quiet-select` "runs the rest of the backlog while catch-up waits, and leaves the catch-up queued" | `tier-plan-quiet`, same name |
| `catch-up-quiet-select` "takes an edit's file and a promoted catch-up file at once" | `tier-plan-quiet` "an edit's tier takes catch-up files beside its own; a batch of a catch-up file starts" |
| `catch-up-quiet-select` "holds catch-up from the second group's turn, which takes the rest of the backlog" | `tier-plan-quiet`, same name |
| `pool-wait` "a refused backlog tier waits in its lane; a refused batch's goes on and starts no wait" | `tier-start-batch`, same name (the act step's `take` arguments); the plan's `refusalWaits`: `tier-plan` "the backlog: a grant ask ..." and "423: ..." |

Kept: `backlog-quiet-select` "a revision that queues a file of the lane starts the wait again; another lane's does not" and "publishes each wait's end for status ..."; `catch-up-quiet-select` "a revision that queues a file ...; a catch-up revision starts none", "publishes catch-up's waits beside the others ..." and the new `quietSleepMs` case; `pool-wait`'s two `PoolWaits` and `TierCapacity` describes, unchanged.

Retired: `tier-plan` "a lane that waits for quiet takes no backlog tier, but an edit's tier takes the backlog's files" (011-346), which `tier-plan-quiet`'s first two cases cover with more files.

## Test support changes

- `tier-plan-table.ts`: `Table.catchUpQuiet`, the lanes whose catch-up waits. `quietHolds` holds a catch-up row in a backlog tier or a turn, as `quietHolds` (`quiet.ts`) does; `quietWakeMs` counts it.
- `tier-start-fixture.ts` (new): `tier-start.test.ts`'s fixture, exported. The fake pool now also logs each take's `waitsIn` and `refusalWaits` and an unleased tier's `running(workers)`; the runner's `run` logs its `workers`. `tier-start.test.ts`'s first case reads `calls` with `toMatchObject` for that reason.

## For the scheduler cases the plan table repeats (011-346's list)

The rows of 011-346's table that named `batch-select`, `focused-group-turn`, `promoted-tier-select` and `batch-busy-host` now name the cases above. The real-scheduler repeats stay as 011-346 listed them (`batch-tier`, `focused-turn`, `catch-up-turn`, `backlog-slots`, `slots-backlog-turn`, `batch-beside`, `claims`): removing them is a later quality row.

## Decisions the brief did not settle, and my choice

1. Sequence cases are split by owner of each fact: the plan's decision, the act step's take and count, the queue's counters. A sequence through a real plan and act step over a `Ledger` would be `selectTier` again under another name.
2. `batch-busy-host` went whole, as it held no case the brief keeps.
3. The catch-up `quietSleepMs` assertion, inside a moved case, is quiet state; it stays as a case of its own.

## Type changes

- Removed: `selectTier` (export of `tiers.ts`).
- Added (011-347): `Promotions.now()`; optional `now` on `Promotions.rankOf`, `RunQueue.ordered`, `RunQueue.orderedBatches`, `Ledger.ordered`, `Ledger.orderedBatches`.

## Checks run (2026-11-14)

See the final report for the outputs; summary here once the runs end.
