# Issue 7: `why` under store contention

Research for spec 001, 2026-10-16, from `research/issue-7-brief.md` and hearsay-tools/squeal#7. Linux 6.8, Node v24.21.0, SQLite 3.53.4 (`node:sqlite`). Squeal 0.1.200 from the committed bundle `plugins/claude-code/dist/cli/squeal.mjs` at `23f276c2`, and the installed 0.1.199 plugin (`~/.claude/plugins/cache/hearsay/squeal/0.1.199`). `git diff squeal--v0.1.199..23f276c2` touches nothing under `src/core/status`, `src/core/store` or `src/cli/main.ts`, and `origin/cand/0.1.201` (001-422) touches none of them either. Load average 23 to 35 during the runs. Probes and their output: `probes/issue-7/`, `probes/issue-7/logs/run-all.txt`.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does issue 7 reproduce? | Yes, on 0.1.200 and 0.1.199, every time a writer holds the store's write lock when `why` resolves a partial name. | verified by experiment |
| 2 | What is the first store access, and is it the one that fails? | `why` (`src/cli/main.ts:177`) calls `readWhy` (`src/core/status/why.ts:59`), which opens the store through `withStatusStore` (`src/core/status/open.ts`) at a 1,000 ms busy timeout and runs in one `BEGIN` read transaction. The open and the read transaction pass under a writer. The failing statement comes later. | verified by experiment |
| 3 | Which statement fails, and why so fast? | `results.byKey(key, 0)` in `held()` (`why.ts:119`) runs `UPDATE results SET last_used_at = ? ...` (`src/core/store/repos/results.ts:31`) inside the read transaction. The read-to-write upgrade returns `SQLITE_BUSY` at once; SQLite skips the busy handler there. | verified by experiment, read in official docs |
| 4 | Lock released before the 1,000 ms budget against after it? | Same failure both ways: `why` exits 1 in 0 ms of SQLite time (104 to 225 ms wall, mostly Node start), whether the lock frees 300 ms, 600 ms or 3,000 ms later. It never waits, so the budget is never used. | verified by experiment |
| 5 | Is evidence unavailable or deleted? | Unavailable. The rows are intact: after each of the 12 busy failures in `logs/run-all.txt`, `why` right after the release prints the report, exit 0 (for `no such check`, "No check matches", exit 1, as without a lock). The failed UPDATE matches no row (`last_used_at < 0`) and rolls back. | verified by experiment |
| 6 | Does it happen with a real daemon, not only a synthetic holder? | Yes: 1 of 60 `why` calls while a real daemon validated an edit every 0.5 s on the scratch repository, `busy after 171 ms (exit 1)`. | verified by experiment |
| 7 | Distinct gap, or an update to 001-207, 001-346, 001-362, 001-422 or #1? | Distinct. Same SQLite rule as 001-207 (a busy upgrade skips the handler), different statement and surface: a read command that writes. | read in source code, inferred |

## Findings

### 1. The reproduction

`setup.sh` makes a scratch git repository with a node:test file holding tests named after issue 7's queries, runs `squeal init` and `squeal warmup` with HOME in the scratch directory; a real daemon stores the results. The daemon is then stopped, so the only contender is `hold.mjs`. `attempt.sh` takes the lock, waits 100 ms, runs `squeal why '<check>'` once, waits for the release, and runs `why` again.

| Holder (`hold.mjs`) | Hold | Query | `why` wall time | Exit | stdout |
|---|---|---|---|---|---|
| `BEGIN IMMEDIATE` + 1 write | 300, 600, 3,000 ms | `parseApplyCheck counts distinct fork-deleted` | 109 to 225 ms | 1 | `Status unavailable, store busy for more than 1000 ms` |
| `BEGIN EXCLUSIVE` + 1 write (WAL: same lock) | 3,000 ms | same | 104 to 151 ms | 1 | same |
| `BEGIN IMMEDIATE` + 1 write | 3,000 ms | `no such check` | 141 to 150 ms | 1 | same (not "no matching check") |
| `BEGIN IMMEDIATE` + 1 write | 3,000 ms | `[test] test/fork.test.mjs > parseApplyCheck counts distinct fork-deleted` (exact) | 134 to 171 ms | 0 | the report |
| `BEGIN` + 1 read | 3,000 ms | partial | 115 to 145 ms | 0 | the report |
| `locking_mode=EXCLUSIVE` + write | 600 ms | partial | 562 to 604 ms | 0 | the report, after waiting |
| `locking_mode=EXCLUSIVE` + write | 3,000 ms | partial | 1,115 to 1,153 ms | 1 | `store busy for more than 1000 ms` |

stderr was empty in every attempt. Under the same `BEGIN IMMEDIATE` hold, `squeal status` and `squeal failures` exit 0 with their answers. *Verified by experiment, `logs/run-all.txt`, both versions.*

The last two rows are the control: a lock that really blocks readers (no product connection takes `locking_mode=EXCLUSIVE` on the store) gets the bounded wait D8 promises, and a release inside the budget recovers. Issue 7's first acceptance criterion already holds for that lock. The ordinary write lock, which every daemon of the repository takes for each short `BEGIN IMMEDIATE` (D8), fails `why` without any wait.

### 2. The failing statement

`trace-open.mjs` replays `connect()` (`src/core/store/open.ts:66`) statement by statement under a held write lock: `busy_timeout`, `user_version`, `page_count`, `journal_mode = WAL`, `synchronous = NORMAL`, then `BEGIN; SELECT; COMMIT`. Each returns in 0 to 1 ms. A scratch copy of the bundle, with one `process.stderr.write(error.stack)` added in `withStatusStore`'s catch (outside the worktree), printed:

```
TRACE errcode=5 errstr=database is locked
Error: database is locked
    at Connection.run
    at Object.byKey
    at Array.flatMap (<anonymous>)
    at held
    at resolve4
    ...
    at Connection.read
    at readTransaction
```

`held()` runs for every query that is not an exact known check (`why.ts:64` to `65`). It calls `store.results.byKey(key, 0)` for each current key of the worktree. `byKey` always runs `UPDATE results SET last_used_at = ? WHERE key = ? AND last_used_at < ?` first; with `usedAt` 0 it matches no row, but the statement still needs the write lock. Added to `byKey` in `2758708a` (2026-10-04, from 0.1.62); called from `why` since `3231a087` (001-188, 2026-10-09, from 0.1.86). *Read in source code.*

`upgrade.mjs`, the same no-row UPDATE at `busy_timeout = 1000` under a held write lock: alone it waits 1,003 ms and fails; as the first statement in `BEGIN` it waits 1,005 to 1,012 ms; after a `SELECT` in the same transaction it fails in 0 to 1 ms. *Verified by experiment.* SQLite's `sqlite3_busy_handler` page: "If SQLite determines that invoking the busy handler could result in a deadlock, it will go ahead and return SQLITE_BUSY to the application instead of invoking the busy handler. Consider a scenario where one process is holding a read lock that it is trying to promote to a reserved lock..." *Read in official docs*, https://www.sqlite.org/c3ref/busy_handler.html, fetched 2026-10-16.

So the message is false as well as unhelpful: "busy for more than 1000 ms" after 0 ms of waiting, against the styleguide's "say what is unknown" and D7's honest snapshot.

### 3. Same class elsewhere, not reproduced

`src/cli/warmup.ts:282` runs `withStatusStore(..., durations)`, and `durations` calls `byKey(row.key, 0)` inside it (`warmup.ts:294`); a busy result returns `[]`, so warmup's slow-file suggestions would vanish silently under a writer. *Read in source code, not run.* The other `byKey` callers (`scheduler/bootstrap.ts`, `store-results.ts`, `ledger.ts`, `state/sink.ts`, `delivery/attribution.ts`) were not traced to their transaction kind.

### 4. Related rows and issues

| Row or issue | What it covers | Relation to issue 7 |
|---|---|---|
| 001-207 (done, 0.1.97) | Store open's WAL switch skips the busy handler on its lock upgrade; it now retries for the busy timeout. | Same SQLite rule. Its fix is on the open path, which passes here (finding 2). Not a duplicate. |
| 001-346 (planned) | The daemon's optimizer note write fails under a writer longer than its 5 s timeout. | Daemon write past a real wait. Not a duplicate. |
| 001-362 (done, test-only) | Daemon start beside long writers; it named "a read transaction that then writes" as a candidate, and the cause was the test's writers. | Names this class but found it elsewhere. Not a duplicate. |
| 001-422 (review, cand/0.1.201) | Daemon passes and timers retry on a busy store; hearsay-tools/squeal#1's first criterion. | Daemon only; touches no file on `why`'s path. Not a duplicate. |
| hearsay-tools/squeal#1 | Daemon and scheduler stop on `database is locked`. | Daemon availability; issue 7 is a read command's. Related, not a duplicate. |

*Read in `docs/board.md` and the issues at 2026-10-16.*

## Recommendation for Squeal

Issue 7 is a distinct gap: a new 001 row, not an amendment of an existing one. The tradeoff that decides the fix: the issue's own criterion, a bounded retry, would make `why` return evidence after the lock clears, but each retry repeats the same 0 ms upgrade failure, so it spins until the lock frees and leaves a read command taking the write lock. Taking no write lock on `why`'s path (a read-only lookup when `usedAt` is 0, or none at all) removes the cause; with it, no retry is needed for the write lock, and the existing 1,000 ms busy timeout stays the bound for locks that do block readers (finding 1, last rows). The regression the issue asks for fits either way: hold `BEGIN IMMEDIATE` from a second process across a partial-name `why` and expect the report, plus the existing timeout path under a reader-blocking lock. The message should also stop claiming a wait that did not happen. The choice of fix, and whether the row also covers `warmup`'s same call (finding 3), is the coordinator's and the human's.

Vision: `why` is how the agent gets "evidence, not a bare verdict" (vision 7) and pulls state; a pull that fails whenever any daemon of the repository writes, and says it waited, works against "push transitions, pull state" and an honest snapshot. A fix passes the decision filter.

## Open questions

- Whether the other `byKey` callers run inside read transactions, and so share the failure. Not determined, because they were not traced (finding 3).
- How often it hits in a busy multi-worktree store like cezar's. Not determined: one scratch repository gave 1 in 60; cezar's store was not locked or probed, as the brief forbids.
- Issue 7's second query's exit code. Not determined, the issue did not capture it; its output matches this reproduction.

## Sources

- hearsay-tools/squeal#7, #1: https://github.com/hearsay-tools/squeal/issues/7, https://github.com/hearsay-tools/squeal/issues/1 (read 2026-10-16).
- `src/cli/main.ts:177`, `src/core/status/why.ts:59-123`, `src/core/status/open.ts`, `src/core/store/open.ts:49-122`, `src/core/store/connection.ts:64`, `src/core/store/repos/results.ts:30-43`, `src/cli/warmup.ts:282-298`, at `23f276c2`; commits `2758708a`, `3231a087`.
- SQLite `sqlite3_busy_handler`: https://www.sqlite.org/c3ref/busy_handler.html.
- `docs/board.md` rows 001-207, 001-346, 001-362, 001-412, 001-422; spec 001 D7, D8, D12, goal 6.
- Probes: `research/probes/issue-7/` (`setup.sh`, `hold.mjs`, `attempt.sh`, `trace-open.mjs`, `upgrade.mjs`, `live.sh`, `run-all.sh`), output in `logs/run-all.txt`.
