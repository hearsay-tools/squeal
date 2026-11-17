# Row 005-96: the scheduler records what the late bound reads

Worker 74012cb8, wave 119 W1 (`../../../011-core/tasks/wave-119.md`), 2026-11-17. Base: main at 0.1.531 (`23f67d006`). Read-side contract: `contract.md` (this folder). Why: `../../reviews/0.1.530.md` B2, B3; `../../reviews/0.1.530-r2.md` R2-B1.

## Design (written before the code)

### Where the write goes

**Inside the transaction that starts the tier.** `startTier` (`src/core/scheduler/tiers.ts`) runs one `BEGIN IMMEDIATE`: it takes the files off the queue, sets their running keys and claims, writes the unfinished run row and commits the ledger. The record is written in that same transaction, as its last write, in a savepoint of its own (`store.transaction` nests as a savepoint). So:

- The record and the start commit together: when the start commits, the record holds the tier (contract need 1, freshness). No second `BEGIN IMMEDIATE` exists, so no second lock acquisition can meet a competing writer between the start's commit and the flight. This removes R2-B1's gap rather than handling it: there is nothing between the commit and `fly` that can throw on a busy store.
- The record can still fail inside the transaction (a row that does not parse is not a failure: it reads as nothing recorded; a programming error or a SQLite error on the one `meta` write is). The record catches every error of its own: the savepoint rolls back the sample's write only, and the start goes on and commits (contract need 2, a failed write loses at most the sample). It never throws into `startTier`, which matters because the ledger's in-memory moves (queue, running keys, claims) are made before the commit and are not undone by a throw.
- The lock is already held when the record runs, so it cannot get `SQLITE_BUSY` on its own. Its cost is one `meta` read, one JSON parse and one `meta` write, inside the lock turn the step already holds, with no extra commit (no extra WAL sync).

`startTier` gains one optional mark, `started(tier)`: called inside its transaction after the start's own writes, and only when a tier starts. `act` in `tier-start.ts` passes the record with the tier's grant. `startTier` stays the generic start: the slow lanes' `#start` (`slow-tier.ts`, not this row's) passes nothing and records nothing, as on the wip branch, whose call site was `act` only.

### Rejected: after the run has flown

`startNext` calls `options.fly(tier)` right after `act` returns. A write after `fly` cannot strand a launch, and a lost sample is acceptable. But it is a second `BEGIN IMMEDIATE` in the step's lock turn (or a deferred write after it): it waits on the busy slice when another process holds the lock, which lengthens the turn by up to that slice, and its failure must be caught at a place that no longer knows the tier's facts unless they are captured first. It adds a commit (a WAL sync) per edit tier. The in-transaction write has none of these costs and no gap at all.

### The start stamp

The first start's delay is `tier.startedAt - revision.createdAt`, floored at 0. `tier.startedAt` is `newTier`'s action stamp, the tier's own start stamp (row 011-372 keeps it as the tier's one clock reading for its start). The record reads no clock of its own: no `context.now()` fallback, so `step-reading.test.ts`'s list of clock reads does not change.

### Which tiers

Only `kind === "edit"` tiers from `act` write; a backlog, turn, slow or focused tier writes nothing (contract need 5). A focused tier never reaches `startTier`. Both lists keep the newest 20 (need 4). The row's key is `worktreeMetaKey("editTimings", worktreeId)`, registered in `WORKTREE_META_ROWS`, so `WorktreeRepo.remove` drops it with the worktree's other rows (need 4).

### The lock turn

Measured before and after with card 7's method (`../../../011-core/tasks/011-357/notes.md`): the catch-up fake runner, a scratch `HOME`, a private store, one run at a time, the host's real load stated. The probe and its outputs are in `probe/` (this folder). Results: section "The lock turn" below.

### What the wip branch brings, and what it does not

From `origin/wip/005-93`: `src/core/scheduler/edit-timings.ts` (the record, `readEditTimings`), `src/core/delivery/late-timings.ts` (`pastBound`, `worktreeMedians`) with the pure bound it calls, `src/core/delivery/late-bound.ts`, the registry line, and the tests `test/scheduler/edit-timings.test.ts` and `test/delivery/late-bound.test.ts`. `late-bound.ts` is not in the brief's list; `late-timings.ts` imports `lateBoundMs` and `median` from it and the contract's `late-bound.test.ts` tests it, so it comes too, unchanged. Nothing of `late.ts`, `late-format.ts` or the delivery paths (row 005-97). Nothing calls `pastBound` in product code yet: 005-97 does.
