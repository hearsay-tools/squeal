# 021-09: shorter holds, a log line per long write, WAL size (2026-11-11)

Spec D3 and D4. Commits `2b6507cfd` to `88c61f4cd` on `cez/ff966b5d`.

## What changed

| Item | Where | How |
|---|---|---|
| Hook's hold waits on no other file (D3.1) | `delivery/held-connection.ts`, `prepared.ts`, `code-source.ts`, `harness/shared/context.ts` (one `Prepare` field, by agreement) | Coordinator's decision B. A `hold()` opened while this thread holds another database runs its `BEGIN IMMEDIATE` with `busy_timeout = 0`, then restores the timeout. Before the store hold, `startHold` runs `Prepare.beforeHold` = `codeLockFree(code)`: it waits, at most the hook's busy timeout, for `code.sqlite`'s write lock with no lock held (an empty `BEGIN IMMEDIATE`/`COMMIT`). A code part still busy inside the hold fails at once; `withCode` drops it, it is not marked told, and the next boundary tells it. |
| Long write line (D3.2) | `store/long-write.ts`, `store/connection.ts`, `daemon/lifecycle.ts` | `Connection.transaction` times each outermost transaction from `BEGIN IMMEDIATE` returning to its end, only while a sink is set (`logLongWrites`; the daemon's `startTimers` sets it, its stop unsets it). Past 250 ms: `long write: store.sqlite write lock held 312 ms by Ledger.recordTier < ... ; 4 rows written`. The operation is the nearest three stack frames outside the store layer. Autocommit `run` calls and `HoldingConnection` holds are not timed. |
| Prune in slices (D3.3, prune only) | `store/prune.ts`, `store/prune-rules.ts`, `daemon/sliced-prune.ts`, `daemon/lifecycle.ts` | `pruneSlices` yields one write transaction per slice. New batches: a removed worktree's rows per table, 256 a slice, root re-tested in each slice (`file_hashes` is `WITHOUT ROWID`, batched by `path`), then `WorktreeRepo.remove`; unreferenced runs, read first, deleted 256 a slice, re-tested. `Store.prune` still runs all slices at once. The daemon drives them with `SlicedPrune`: one slice per event-loop turn, then a pause as long as the slice held the lock (at least 10 ms); a busy slice is tried again after `busyBackoffMs` and told to `busyWaits` as `pruning`; then the code-store prune runs as before. The retention rules moved unchanged to `prune-rules.ts`. |
| WAL size (D4) | `store/open.ts`, `daemon/idle-checkpoint.ts`, `daemon/lifecycle.ts` | Every store connection sets `journal_size_limit = 64 MiB`. A daemon whose `work()` showed no pending edit, no owed work, nothing queued and the same revision for 60 s runs `PRAGMA wal_checkpoint(TRUNCATE)` with a 100 ms busy timeout, then again once a minute while it stays quiet. |

## Decisions the spec did not settle

- **Rows, not WAL frames, in the long-write line.** The first version read `mxFrame` from the `-shm` header (offset 16), as the research's `lock-watch.mjs` did from outside. Inside the daemon that opened and closed a descriptor of `-shm`, and closing any descriptor of a file drops every POSIX lock the process holds on it, SQLite's wal-index lock and write lock included. Another opener then rebuilt the `-shm` under the daemon's mapping: `test/daemon/start-short.test.ts` saw the old daemon die of SIGBUS (revision 19). The line now counts `total_changes()`. A hold that wrote nothing shows 0 rows as it showed 0 frames. Regression test: `keeps this process's locks on the store while it measures` (`test/store/long-write.test.ts`); it fails on the frame version.
- **The pause between prune slices.** A fixed 100 ms (SQLite's longest busy-handler sleep) made the 300,000-result prune of `test/daemon/shared-store.test.ts` take over 117 s, past its 120 s bound. The pause is now as long as the slice's hold, so the prune holds the lock at most half the time.
- **Idle means `TimerContext.work()` quiet.** `lastActive` counts registered consumers, so it is recent during every session; the idle GC's quiet time is private to `idle-gc.ts`. A tier that runs with nothing queued counts as quiet; the checkpoint's 100 ms bound keeps that cheap.
- **Values.** 64 MiB: on 2026-11-11 16:38Z to 16:40Z (1 Hz `mxFrame` samples from the `-shm` header with `od`, from a separate process, load 17.9), the live WAL peaked at 6,037 frames (24 MB) on squeal's store and 4,369 (17 MB) on cezar's, and restarted many times (minimum 4 to 7 frames); the files stood at 66 MB (squeal) and 422 MB (cezar), code stores 20 MB and 186 MB. **Not measured on a copy of cezar's store** as D4 asks: a 4.3 GB copy on a host above its load knee was not made. 60 s idle is the spec's; the 100 ms busy bound is mine.

## Not done here

- **The hook's hold still spans the host's read of its output** (coordinator, decision 2): `HandOff` commits after the stdout write callback, bounded at 2 s. Removing it needs a two-phase told record; it moves to row 021-16 (writes through the daemon).
- **`code.sqlite`'s WAL** has no size limit and no idle checkpoint: its opener is `src/core/code/store/open.ts`, outside this row. Cezar's code WAL file was 186 MB.
- **Single-transaction prune steps remain:** `checks` (its `NOT IN` scans `results`, `known_states`, `consumer_views`, `transitions`), `checkpoints`, `expireReplaced`, `dropFallenUnknownRuns`, orphan failure texts. `known_states` and `consumer_views` have no index on `check_id`, so a batched re-test would scan them under the lock per batch. If the long-write line names `pruneSlices` with a long hold, these are the candidates.
- **CI import slicing** (`transfer-import.ts`) is spec 018's.

## For the next worker

- In a process with a SQLite connection to a store, never open and close a descriptor of the database, its `-wal` or its `-shm`. `statSync` is safe; `openSync` plus `closeSync` is not. This applies to `lockHolders` (021-10) called from `hold`/`stop`/`start` (021-07).
- `Prepare.beforeHold` runs only while the thread holds nothing (`holdingAny()` false and no transaction on the store connection), so a delivery inside an open hold never waits.
- `logLongWrites` is per thread. A worker thread that writes the store logs nothing until it sets its own sink.
- `startTimers` now uses `connectionOf(store)` for the prune and the checkpoint; with a `Store` not opened by `openStore`, the first prune logs `prune failed` and a due checkpoint logs `idle checkpoint failed`.
