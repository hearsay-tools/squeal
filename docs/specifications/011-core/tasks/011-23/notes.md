# 011-23 notes (W2 of wave 5, 2026-10-20)

A stale file adopts a result another worktree stored at its key: each reconciliation pass and each tier selection read the keys stored since the last read, with an overlap, and settle this worktree's files at those keys through C4 step 3's lookup (spec 011 C4 step 3 as amended 2026-10-20; `research/catch-up.md` finding 3, option (b), Recommendation, 011-23's done-when). Base: `cand/0.1.225` (`c141fa8f`).

## The seam map

- `src/core/store/repos/results.ts` `keysSince(since)`: `KEYS_SINCE`, each key recorded after `since` with its newest `recorded_at`. It names `INDEXED BY results_by_time`: for `GROUP BY key` (and for `DISTINCT key`), SQLite plans a full scan of `results_by_key`, which costs 0.56 s on a 300,000-row store even for an empty window. R3's 0.02 ms (`adoption-cost.mjs`) was a query with both bounds, which SQLite does range over `results_by_time`. `StoredKey` and `ResultRepo.keysSince` are additive types (`src/core/types/store.ts`).
- `src/core/scheduler/stored-keys.ts` `StoredKeys.adopt(context, ledger)`: the watermark (`#readAt`, when the previous read began; at first the scheduler's construction, before the baseline's lookup), `STORED_KEYS_OVERLAP_MS` (120 s), and `#seen`, the keys read within the overlap at their newest time, so a key read again with the same time is not new. The files it settles: key among the fresh keys, and no `resultKey`, `runningKey` or `unknownKey` at it. Then `Ledger.settle(refs, NOTHING_CHANGED, { queueMisses: false })` and `ledger.commit()`, under `Ledger.hold(refs)`: a busy store's throw restores the ledger, and the watermark and `#seen` move only after the commit landed.
- `src/core/scheduler/scheduler.ts` (shared with 011-22, its own commit): the `#storedKeys` field, `#adopt` (returns at once while runner work waits or refines), called in `#pass` after `confirmHeld` and `takeRetries`, before `reconcileBatch`, and in the pump's selection hold before `selectTier` (once per hold; the slot loop's extra selections do not read again).
- `src/core/daemon-loop/`: unchanged. The change feed's idle timer already hands every `interval` pass to `Scheduler.handleBatch`, whatever it found (`reconcileNow` emits an empty batch), so the hook is `#pass`. The daemon-loop test drives it through the loop's own timer.
- `src/core/keys/key-format.ts`: `KEY_FORMAT_VERSION` 17, hash `55b7673e…cc99`. W1 may raise it too.

What `Ledger.settle` already gives (`research/catch-up.md` finding 3, "Provenance and C5 hold"): `probe` withholds every hit of a file when another worktree's fail is unconfirmed here (`heldFailure`), `applyResults` keeps the result rows, so `derive.ts` reads the origin as inherited from that worktree at its commit, and the open checkpoint that requested a file counts it done (`checkpoints.idFor`).

## Tests (011-23's done-when)

`test/scheduler/adoption.test.ts`, on `claims-fixture.ts`'s two schedulers (own store connections, fake runner):

| # | Test | Red without the change |
|---|---|---|
| 1 | two worktrees on one commit under `lookup-only`; after a's `run --all`, one `interval` pass makes b's 6 files current, none run in b, origin `inherited` from a at a's commit, no row queued | yes (scheduler calls removed): 0 of 6 |
| 1 | the same through `createDaemonLoop` with `reconcileIntervalMs` 200 and no explicit pass | yes: 0 of 6 at 10 s |
| 2 | a's fail at f00 stays held in b: no known state or failure, `why` reads "Inherited FAIL from … being confirmed", nothing queued, and a second pass queues nothing | yes |
| 2 | under `lookup-then-run-missing`, b's first tier held: one pass takes the four passes at once while the tier still runs; the held fail stays queued and runs in b after it | yes: the four stayed queued |
| 3 | after adoption, a stores at a key no file of b holds; with the store's write lock held from another connection (busy timeout 50 ms), b's pass and pump write nothing | yes (precondition); and with `#seen`'s skip removed: "database is locked" |
| 4 | a result stored after b's read with `recordedAt` 60 s before it is adopted on the next pass | yes; and with the overlap at 0 |
| 5 | a pass a busy store stopped at the lookup's write, or at the commit, adopts on the next | yes, both; the commit case also without `restore()` |

`test/store/keys-since.test.ts`: the newest time per key after `since`, and `EXPLAIN QUERY PLAN` of `KEYS_SINCE` searching `results_by_time` (red without `INDEXED BY`).

## The overlap margin

The overlap must exceed the longest gap between a result's `recordedAt` and the commit of its transaction. Bound by construction, then measured.

- `recordTier` takes `recordedAt` (`context.now()`, `tiers.ts`) inside `#record`'s `store.transaction`, a `BEGIN IMMEDIATE` that holds the write lock from its start. So a busy store's wait and its 001-422 retries come before `recordedAt`: a record that gives up re-queues its files, which run again under a new time. What remains is the transaction's own length: `recordTier` and the ledger's commit, synchronous, then `COMMIT`. A slot's record is its own transaction too (`commit` false only defers the ledger's writes to `SlotRecords`' commit). `putMany` has no other caller.
- Measured here (`margin.probe.ts`, copied to `test/e2e/` to run, outside the daemon's set): a store seeded with 300,000 result rows, 600 test files of 20 checks each, `run --all` in backlog tiers of 200, so 3 records of 4,200 rows: the gap was 326, 327 and 386 ms at load 18.8 on 24 CPUs, and 280, 323 and 435 ms (then 360, 385, 410 ms) at load 19.5 to 20.5.
- Seen on cezar: a commit of slots 55 to 340 ms of write lock (011-21 slice 2); a 198-file tier's record held the lock 11 to 67 s (001-161, before slots, at loads above 20).

120 s is about 1.8 times the worst record ever seen on cezar and 270 times what this host measured under load 20. Its cost is the read: every key recorded within the last 120 s plus the time since the previous read is scanned again (and skipped through `#seen`). With the index: 0.004 ms for an empty window, 4.9 ms for a window of 600 keys (12,600 rows) on the seeded store, best of 5 at load 20. A miss costs more than a wider read: under `lookup-only` a late row missed stays unadopted until its key next changes or another store lands at it.

Not covered: a store by an older Squeal that took `recordedAt` before its transaction began (then a busy wait of up to 5 s, `DAEMON_BUSY_TIMEOUT_MS`, adds to the gap, still well inside 120 s), and a host clock step larger than the margin between two daemons' reads.

## Decisions the spec did not settle

- **A file `unknown` at its key** (crashed or timed out here, D12) is not adopted: `Ledger.settle` treats `unknownKey` as needing nothing, and its branch for it takes a file queued at that key out of the queue. The spec's "a file whose key has no result here" reads wider. 011-27 (`retry` of a timed-out file) is where it belongs, if anywhere.
- **A queued file is adopted and leaves the queue**, as `selectTier`'s own look-up before a run does; a held fail stays queued. Under `lookup-then-run-missing` this takes another worktree's results ahead of the queue reaching them (done-when 2's second test).
- **The first read** reaches back to the scheduler's construction less the overlap, so a row that committed during the baseline's lookup is still read.
- **No read while runner work waits**: its keys would come from a revision the runner has not invalidated yet, the same reason `selectTier` waits. The pass after the refinement reads.
- **`changeMarker` is not used** to skip a read: an idle pass already costs 0.004 ms once the window empties, and on a shared store `data_version` moves at every heartbeat.

## For the next worker

- Done-when 5, cezar live, is the coordinator's below load 8: `research/probes/catch-up/second-worktree.mjs`'s shape on a store copy, before and after.
- 011-22 (W1) edits `scheduler.ts` too. My lines: the import, the field and its doc, the constructor's `new StoredKeys(...)`, `#adopt` and its doc, `this.#adopt(context, ledger)` in `#pass` and in the pump before `selectTier`. Both rows raise `KEY_FORMAT_VERSION` to 17 with different hashes; the merged tree needs one new pin.
- The read's cost grows with the keys recorded in the window: a burst of several worktrees' `run --all` within 2 minutes is the worst case (about 1.5 ms per 200 keys, a read per pass and per pump hold).
