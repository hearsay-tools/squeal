# 011-347: one clock reading orders the queue

Worker 23d565cd, 2026-11-14. Brief: `tasks/wave-95.md` W2. Design: `research/tier-plan.md`, "One clock reading".

## The defect, and the test that caught it

`RunQueue.#ranks()` called `Promotions.rankOf(id)` once per queued entry, and each call read the clock. A member of a batch is ranked at any reading. A selected file in no batch yet (queued again during the wait, before the next settle joins it) is ranked only while its wait is open. So in one `ordered()` call, a wait that ended between two readings ranked the first entry and not the next.

The test (`test/scheduler/queue-promotion.test.ts`, "orders at one clock reading: a wait that ends between two entries' ranks ranks neither"): Y and Z are selected by one wait; Z runs and an edit queues it again; the clock moves 1 ms per reading, the first at the wait's last open moment. Before the change, `ordered()` returned `y, z, b` (Z read at the deadline, unranked). After it, `z, y, b`, with exactly one clock reading per call. With the decision's `now` passed in, the order reads no clock. So the test could fail before this change, and it did (red at `22da8de1d`).

## What changed

| Where | Change |
|---|---|
| `Promotions.rankOf(id, now?)` | Takes an optional reading; without one it reads the clock, as before. |
| `Promotions.now()` | New: one reading of the promotions' clock. |
| `RunQueue.#ranks(now?)` | Reads the clock once (or takes `now`) and ranks every entry at it. |
| `RunQueue.ordered(durationOf, turn, now?)`, `orderedBatches(durationOf, now?)` | Pass `now` to `#ranks`. |
| `Ledger.ordered(turn, now?)`, `orderedBatches(now?)` | Pass `now` through (parent's grant, request e57ae067: `ledger.ts` is outside the brief's list; no other `ledger.ts` change). |
| `liveView` (`tier-live.ts`) | Reads `context.now()` once into `now`, gives it to the view and to `ordered` and `orderedBatches`. `context.now` is the promotions' clock (`Ledger` sets it). |

`orderedSlow` and `orderedGroup` (slow lanes, not the plan's) also go through `#ranks()`, so each now reads the clock once per call instead of once per entry. Their callers pass no `now`.

## Not changed

- `QueueView`'s interface: the plan's `ordered(turn)` and `orderedBatches()` take no `now`; the live adapter closes over the view's. The plan table is unchanged.
- `isPromoted`, `isFirstGroup`, `isCatchUp`, `hasFirstGroup`, `backlogTurn`'s default and `tierSelected` / `batchSelected` / `focusedSelected` still read the clock per call through `rankOf`. The row names only `rankAt`, `ordered` and `orderedBatches`. A later row may pass the plan's `now` to `isPromoted` and `isFirstGroup` too; the window is the same (a selected file queued again before the next settle).
- No order, write or transaction changed. No key changed.

## Checks

See `tasks/011-349/notes.md` for the shared run. `test/keys/validity/compare.test.ts`, `reach.test.ts` and `test/keys/key-format.test.ts` passed after this row's commit (35 of 35, 80 s) and again at the end.
