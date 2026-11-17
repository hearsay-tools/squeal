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

## What changed

- `src/core/scheduler/tiers.ts`: `startTier`'s marks gain `started(tier)`, called last in the start's transaction, after `ledger.commit()`, only when a tier starts. It must not throw. The slow lanes' `#start` passes none.
- `src/core/scheduler/tier-start.ts`: `act` passes `started: (t) => recordEditTier(context, t, grantOf(t))`. `grantOf` is the grant expression `act` already used for a batch's estimate, now written once.
- `src/core/scheduler/edit-timings.ts` (from the wip branch, changed): `recordEditTier` returns at once for a tier that is not `edit` or has no `startedAt`; otherwise it writes in a nested `store.transaction` (a savepoint inside the start's transaction) and catches every error, so a failed write rolls back to the savepoint and loses only the sample. No `context.now()` fallback: the first start is `tier.startedAt`. `readEditTimings` is unchanged.
- `src/core/types/store.ts`: `editTimings: { prefix: "edit-timings:", owner: "scheduler/edit-timings" }` in `WORKTREE_META_ROWS`, so `WorktreeRepo.remove` drops the row.
- `src/core/delivery/late-timings.ts`, `src/core/delivery/late-bound.ts`: from the wip branch, unchanged. No product code calls them yet (row 005-97 will).

## Tests

- `test/scheduler/tier-start-timings.test.ts` (new):
  - **R2-B1 regression**: the store's busy timeout is 10 ms; a write observer makes a second connection take the write lock as soon as the first transaction ends and hold it; `startNext` with a `fly` counter. It asserts no error, one flight, the run row unfinished, the file off the queue, `tier.startedAt` equal to the clock, and the record holding `firsts: [{ revision, delayMs: 1500 }]` and the tier's run id. **Discrimination**: with the wip placement (`recordEditTier` called in `act` after `startTier`, a temporary edit, reverted) it failed with `database is locked` (`expected Error: database is locked ... to not be an instance of Error`), which is R2-B1's failure. With the record in the start's transaction it passes.
  - A record write that throws (`meta.set` for the key throws `disk I/O error`): the tier starts and flies once, its run row is unfinished, the file is off the queue, and no record exists. With the wip placement it failed (`Error: disk I/O error` out of `startNext`).
  - A row that does not parse is replaced by this tier's record.
  - A backlog tier records nothing.
  - The tier's estimate is the scheduler's own at the grant (two files of 1 s and 2 s at two workers: 2,500 ms).
- `test/scheduler/edit-timings.test.ts` (from the wip branch): the contract's three cases (`pastBound` at width 1 and at tier size 2; more than 20 tiers at one revision, then a later edit: the first start stays 1 s, then the median is 2 s), only edit tiers record, the overhead read. Added: 25 revisions with one edit tier each keep the newest 20 first starts and the newest 20 tiers, newest first.
- `test/delivery/late-bound.test.ts` (from the wip branch, unchanged): the pure bound.
- `test/store/worktree-meta.test.ts` (unchanged): it derives its cases from `WORKTREE_META_ROWS`, so the new row is covered by "drops every row of the removed worktree" and the owner and prefix rules.

The contract's five needs: 1, freshness: the record commits with the start (R2-B1 test reads it right after `startNext`). 2, no stranded launch, a failed write loses only the sample: the R2-B1 test and the throwing-write test. 3, the start stamp: `tier.startedAt`, asserted in the R2-B1 test. 4, bounded and removed with the worktree: the 20-entry test and `worktree-meta.test.ts`. 5, only edit tiers: the backlog test here and the wip's "records only edit tiers" (backlog, slow, turn, focused).

## The lock turn

Two probes in `probe/` (README there). Load is the host's real load, one minute, on 24 CPUs; other projects' processes were running and it was far above the CPU count (34 to 52). Not made on purpose.

**The step's turn that starts an edit tier** (`probe.test.ts`; catch-up fake runner, 2 files per project, 30 rounds of one edit of the source every file imports, `selecting the next tier [start-tier]`). Paired runs on a detached tree at the base `23f67d006` (before) and this branch at `e0d52baec` (after), alternately, 00:10 to 00:11 UTC. Median / p95 / max, ms:

| projects | before 1 (load 37.8) | after 1 (load 41.2) | before 2 (load 41.4) | after 2 (load 42.8) |
|---|---|---|---|---|
| 1 | 3.6 / 5.6 / 5.7 | 4.1 / 8.1 / 9.0 | 3.2 / 4.8 / 5.1 | 3.7 / 9.8 / 10.9 |
| 4 | 3.8 / 5.6 / 8.0 | 4.6 / 8.8 / 9.6 | 4.7 / 9.9 / 11.2 | 5.4 / 10.8 / 13.0 |
| 12 | 5.3 / 12.3 / 40.2 | 5.3 / 10.0 / 20.1 | 5.5 / 8.9 / 13.9 | 7.3 / 19.3 / 29.3 |

The medians grow by 0.0 to 0.8 ms in five of the six pairs and by 1.9 ms in one (12 projects, pair 2). In that run the turn this row does not touch, `recording the results of a tier`, also grew (median 5.6 to 7.5 ms), so that pair is mostly the load rising (42.6 to 44.5). At this load the whole-turn probe cannot separate a change below about 1 ms. The record was written in every after run (1.9 to 2.3 kB) and in no before run.

**The record alone, inside a start transaction** (`record.test.ts`, `record.txt`; a private store, 300 iterations, each one `BEGIN IMMEDIATE` with a stand-in start write, alternately without and with `recordEditTier`; one tier of 4 files; the width map filled to 1, 12 and 100 projects first). Load 47.2. Added cost, median / p95 / max, ms: **1 project 0.073 / 0.47 / 5.6; 12 projects 0.058 / 0.34 / 7.2; 100 projects 0.14 / 0.37 / 8.7**. The maxima are load spikes: the transaction without the record had maxima of 0.9 to 10.2 ms in the same runs. No extra commit and no second lock acquisition: the old wip placement's own `BEGIN IMMEDIATE`/`COMMIT` is gone, and it could wait a whole busy slice under a competing writer, which this placement cannot.

So the growth is a tenth of a millisecond at the median, below the "few milliseconds" that would need the coordinator before landing. Review N1 (an uncapped width map) is bounded in practice by the worktree's project count; at 100 projects the record adds 0.14 ms.

## Decisions the brief and contract did not settle

- **The start stamp is `tier.startedAt`** (`newTier`'s action stamp), not the step's `at`. The contract says "the step's reading (row 011-372), the one the tier's start stamp uses"; row 011-372's notes keep `newTier`'s `startedAt` as the tier's own start reading, and review 0.1.530-r2's closure 2 accepted it. Reading `at` would date the start before the work done in the turn. No clock read is added, so `step-reading.test.ts`'s list is unchanged.
- **The slow lanes' edit-kind tiers do not record.** A check group at normal priority starts `edit`-kind tiers through `slow-tier.ts`'s `#start`, which calls `startTier` too. The wip branch recorded only from `act`, and `slow-tier.ts` is not this row's, so `#start` passes no `started` and records nothing. If 005-97 needs group lanes' widths or starts, `#start` would pass the same callback.
- **A SQLite error that aborts the whole transaction** (`SQLITE_FULL`, `SQLITE_IOERR`, which roll back more than the statement) inside the record would make the start's commit fail too. The start's own writes have the same exposure, so this row adds no new failure kind; an ordinary error rolls back to the savepoint only (tested).
- `late-bound.ts` came from the wip branch though the brief does not name it: `late-timings.ts` imports it and the contract's `late-bound.test.ts` tests it.

## Type changes

- `startTier`'s marks: added `started?: (tier: Tier) => void` (additive).
- New module `src/core/scheduler/edit-timings.ts`: `TIMINGS_KEPT`, `editTimingsMetaKey`, `EditTimings`, `readEditTimings`, `recordEditTier`.
- New modules `src/core/delivery/late-bound.ts` (`LATE_FACTOR`, `BoundFile`, `LateBoundInput`, `median`, `tierEstimate`, `lateBoundMs`) and `src/core/delivery/late-timings.ts` (`worktreeMedians`, `pastBound`).
- `WORKTREE_META_ROWS`: added `editTimings`.

Not changed: `KEY_FORMAT_VERSION`, any key, tier order or width, status payload, note text, CLI output.
