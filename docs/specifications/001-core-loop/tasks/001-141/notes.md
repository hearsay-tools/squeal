# 001-141: who held the store's write lock (2026-10-08)

003 lessons defect 5: at 09:13:07 worktree 1's scheduler stopped with "database is locked"; the tier begun at 09:12:12 never closed its run row and its four files ran again. A status read had also failed with "store busy for more than 1000 ms".

## Cause

The holder was the prune a daemon runs 60 s after it starts (`lifecycle.ts`, `firstPruneMs`). On a copy of cezar's store (150 MB, 186,811 results, nine worktrees), with one worktree's root removed (80,529 results):

| step | write lock held |
| --- | --- |
| `worktrees.remove` | 0.8 s |
| one `DELETE FROM results ... NOT IN (live keys) AND rowid NOT IN (main newest)` plus orphan failure texts | 15.1 s (the statement alone 12.4 s) |
| bare `PRAGMA incremental_vacuum` (8,398 free pages) | 1.4 to 3.6 s |

The daemon's busy timeout is 5 s (`DAEMON_BUSY_TIMEOUT_MS`), a hook's 1 s. The cost is the row deletes: seven indexes on `results`, about 150 µs a row on that store at load 40 to 160. The `NOT IN` subqueries themselves take under 0.5 s. A prune with nothing to remove still held the lock for 0.85 s.

A second cause of waits: `openStore` ran `PRAGMA auto_vacuum = INCREMENTAL` on every open. On a file already in auto-vacuum mode, SQLite writes header meta[6] in a write transaction, so every hook, status read and CLI open took the write lock and queued behind any writer. Measured 40 to 240 ms per open here.

Ruled out: `integrity_check` at daemon start is a read (1.5 s, no lock in WAL); `journal_mode = WAL` on a WAL file is a no-op; migrations do not run on a current store; the second daemon's start-up writes on cezar's tree measured at most 0.2 s.

## Fix (commit 4401e22)

- Prune reads the prunable row ids in one read transaction (no lock in WAL), then deletes them 256 per `BEGIN IMMEDIATE`, each batch re-testing its own rows. "Not the newest main result of its check" became a per-row `NOT EXISTS` on `results_by_worktree`, equivalent to the old window-function list. The size cap's first tier uses the same per-row rule.
- Orphan failure texts are dropped once, after the batches, in their own transaction.
- `incremental_vacuum(512)` steps until the free list is empty or a step frees nothing.
- `openStore` sets `auto_vacuum` only when `page_count` is 0.

Same cezar copy after the fix: longest hold 172 ms, whole prune 9.3 s (21.6 s before, under different load).

## Tests

- `test/store/contention.test.ts`: 200,000 results of a removed worktree, prune in one process, a writer with the daemon's 5 s busy timeout in another. Old code: one hold of 6.2 s at load 70. New: 787 transactions, longest 163 ms.
- `test/store/open.test.ts`: an integrity-checked open with `busyTimeoutMs: 0` while another connection holds `BEGIN IMMEDIATE` (old: "database is locked").
- `test/daemon/shared-store.test.ts` with `pruning-daemon.ts`: three rounds. In each, a second daemon (from the sources, `firstPruneMs: 0`, on a linked worktree) prunes 300,000 results while the first daemon's tier is held open until the prune starts. Old prune: tier 1's run row never closed. New: green in about 120 s at load 80 to 120.

The seeded rows use sequential keys. Random keys (closer to real hashes) made seeding 200,000 rows take 336 s and their delete 204 s at load 150, so the tests use sequential keys and more rows.

## Left open

- The prune is synchronous: the pruning daemon's own event loop, socket included, is blocked for the whole prune (9 s on cezar's copy). Making it yield between batches would need `Store.prune` to become async.
- `worktrees.remove` is still one transaction (0.8 s for cezar's largest worktree at load 160).
- The scheduler (`scheduler.ts:329`, not owned here) still leaves a tier's run row open when `recordTier` throws; it re-queues the files without ending the run.
- The WAL auto-checkpoint runs in whichever connection commits past 1,000 pages, so a daemon's small commit can pay seconds of checkpoint I/O after a prune. That is not a lock wait, and it never fails.
