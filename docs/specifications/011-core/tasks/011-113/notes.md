# 011-113: a status read gives up on a busy store after 3 ms

Wave 15, W1, repair, from main with 0.1.265 (`804fc3584`). Two fix commits, then these notes.

## The step that gave up

Not the open, a pragma, the WAL switch, `BEGIN` or close. The read transaction wrote. A status read of a failure with a test-file frame looked up the failure's stored row with `results.byKey(key)`. The default `usedAt` of that lookup runs `UPDATE results SET last_used_at = ?`. The snapshot has already read, so the UPDATE upgrades a read transaction to a write one. SQLite skips its busy handler on that upgrade, because waiting there could deadlock. It answers `SQLITE_BUSY_SNAPSHOT` (517) when another connection committed after the read began, and `SQLITE_BUSY` (5) while another connection holds the write lock. Issue 7 (`001-core-loop/research/issue-7.md`, finding 3) and 001-207 hit the same SQLite rule.

Reproduced on the first local run of `test/integration/pytest-environment.test.ts`, with a log of every BUSY in `readOnce` (not committed):

```
3 ms of a 1000 ms busy timeout, errcode 517, "database is locked"
  Connection.run        src/core/store/connection.ts:27   UPDATE results SET last_used_at ...
  results.byKey         src/core/store/repos/results.ts:50
  testFileFrames        src/core/delivery/attribution.ts:132
  withTestFileFrames    src/core/delivery/attribution.ts:154
  snapshot              src/core/status/snapshot.ts:150
  Connection.read       src/core/store/connection.ts:70
```

The lookup came with 011-76 (`e1d42c41d`, 2026-10-21). Only a read of a failure with a location and a key the state sink recorded (`readFailureKeys`) reaches it. In the pytest test, `settle` polls through `until`, which retries a throw, so its early BUSY results were hidden. The last, unguarded `status(main)` failed.

## What was ruled out

- **SQLite source** (3.53.2, the amalgamation in a local `better-sqlite3`). In each step of `readOnce`, a BUSY goes to the busy handler or to a WAL retry loop. `sqlite3BtreeBeginTrans` calls the handler for every BUSY while the connection has no transaction (`TRANS_NONE`). `pager_wait_on_lock` calls it for the SHARED lock. `walTryBeginRead` turns a torn header, a busy read mark and the shared-memory DMS lock into `WAL_RETRY`. `PRAGMA journal_mode = WAL` is a no-op once the first read has opened the WAL (`OP_JournalMode`, `eNew == eOld`). The pager ignores errors in close's checkpoint attempt.
- **Probe** (`probe/reader.mjs`, `probe/writer.mjs`): `readOnce`'s steps, each timed and named, repeated beside 1 to 3 writer processes. The writers ran short `BEGIN IMMEDIATE` transactions, some held up to 20 ms, `wal_checkpoint` in all four modes, `incremental_vacuum`, connection churn, and close and reopen. On Node 22.23.3 (SQLite 3.51.3): 0 BUSY in 7,975 reads over 4 runs.
- **Busy handler** (`probe/handler.mjs`): on Node 22.23.3 and 24.21.0, a reader waits its busy timeout (1 to 1,500 ms) to within 5 ms against a held exclusive lock.
- CI's Node 22.19.0 was not probed. The cause is in Squeal's code, not in the SQLite version.

## Which reads still write

A temporary log in `Connection` recorded every `run` and `transaction` inside `read`. It ran over `test/status`, `test/delivery`, `test/cli`, `test/retry` and `test/harness` (287 files, 2,782 tests). The log recorded 21 writes, all from this one call site (19 from the sources, 2 from a built copy a harness test runs). The same run's BUSY log shows that every other busy read waited its full timeout: 51, 94 to 108, 303 and 1,003 to 1,011 ms, against bounds of 50, 94 or 100, 300 and 1,000 ms. With the fix, no read in those tests writes. Reads that no test reaches are not covered.

Two calls that touch `last_used_at` remain in delivery: `withFlaky` (`attribution.ts:247`) and `beforeEditsFor` (`src/core/state/before-edits.ts:137`), both under `annotate`. The log saw neither inside a read transaction. The coordinator kept them as they are.

## The fix

1. `src/core/delivery/attribution.ts:132`: `store.results.byKey(key, 0)`, a lookup with no write, as `why` does since issue 7. The coordinator agreed to this one edit outside the row's files (2026-10-22). The commit stands alone and its subject names the agreement. `attribute`, the delivery side, uses the same reader, so a hook's frame lookup takes no write lock either.
2. `withStatusStore` (`src/core/status/open.ts`): the default of `busyRetryMs` changes from 0 (one attempt) to the busy timeout. A read that SQLite fails without its handler is tried again, every 50 ms, until the bound. Each attempt opens the store again, so a retry after `SQLITE_BUSY_SNAPSHOT` reads a new snapshot. The total stays within the busy timeout. A lock that blocks readers still uses the whole first attempt, so that case waits no longer than before. The CLI keeps `CLI_READ_RETRY_MS`. Hooks open the store in `src/harness/shared/context.ts` and read status through `createStatusBuilder`, so the retry does not change their budget; the attribution fix covers their frame lookups. The daemon reads no status.

`src/core/store/` is unchanged. The daemon's write paths and their bounds (5 s, 250 ms slices) are as before.

## Consequence

A status read, and a delivery's frame lookup, no longer refresh `last_used_at`. The LRU of the size cap counts only daemon use, as with issue 7's `why`.

## Tests

`test/status/frame-beside-writer.test.ts`:

1. A failure with a test-file frame, read 3 times through status, failures and why while a second process holds `BEGIN IMMEDIATE`. Each read is available, names the frame, and takes less than 1,000 ms.
2. A read that writes, beside a write lock released after 300 ms: it reads after the release.
3. The same read beside a lock held 5 s, at a 500 ms busy timeout: it gives up at 500 ms or later, not at once, and before 2,000 ms.

On the base, all 3 failed. Squeal ran them at revisions 4 and 5, where `src` differed from the base only by the probe logs, which do nothing without their environment variable. Test 1 got `false` (status unavailable) instead of the frame. Tests 2 and 3 gave up after 1 ms. After the attribution commit, test 1 passed. After the retry commit, all 3 passed.

## Considered, not done

A guard that fails any write inside `Connection.read` at once would make a regression deterministic in tests. It would also turn a rare failure into a permanent one on any path the tests miss, so it is not made. The held-lock test catches this path deterministically.
