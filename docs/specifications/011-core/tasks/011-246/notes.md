# 011-246 notes: the WAL-switch test's lock holder failed its own COMMIT

Worker 466e7d75, brief W3 of `tasks/wave-51.md`, base main at 0885eec11. Shape: repair (tests only). Host Node 24.21.0; the probe also ran on 22.23.3.

## Cause

The test "waits out a write lock another process holds when it switches the file into WAL" (`test/store/opening.test.ts`) starts a holder process (`HOLD_WRITE_LOCK`). The holder runs `BEGIN IMMEDIATE` on a file in rollback-journal mode, so it holds SQLite's RESERVED lock. After 500 ms it runs `COMMIT`. The holder opened `DatabaseSync` with no busy timeout (Node's default is 0).

The opener (`switchToWal`, `src/core/store/open.ts:172`) retries `PRAGMA journal_mode = WAL` every 5 ms while the file is busy. Each attempt first takes a SHARED (read) lock. RESERVED lets new SHARED locks in, so the opener gets it. The attempt then fails to upgrade and releases the SHARED lock when the statement ends.

In rollback mode, `COMMIT` writes the database file, so it needs the EXCLUSIVE lock, and EXCLUSIVE needs every SHARED lock gone. If the holder's timer fires while one of the opener's attempts holds SHARED, the holder takes PENDING and finds the SHARED lock. SQLite calls the busy handler in this case: the docs of `sqlite3_busy_handler` name the process that holds RESERVED and wants EXCLUSIVE as the one that may wait, and the reader that wants to upgrade as the one that gets SQLITE_BUSY at once. With a busy timeout of 0 there is no handler, so `COMMIT` failed at once with "database is locked". The exception in the timer callback made the holder exit 1, and the test failed at `expect(await released).toBe(0)` (`expected 1 to be +0`).

The window is the time an attempt holds SHARED, against a 5 ms period, so the failure is rare. Load makes it more likely: an opener that loses the CPU while it holds SHARED widens the window. That fits both sightings: cand/0.1.336's CI 40302302055, Node 22 (1/3), and 006's gate on `f4b3b6ec` under load. Neither wave changed store code.

With a busy timeout, the holder's PENDING lock blocks the opener's next SHARED lock (the opener's own busy timeout waits there, and `switchToWal` retries a busy error anyway). The current SHARED lock ends with its statement, the holder gets EXCLUSIVE and commits, and the opener then switches the file. No deadlock: the opener never waits while it holds SHARED.

## Change

`HOLD_WRITE_LOCK` opens `new DatabaseSync(process.argv[1], { timeout: 10_000 })`. The `timeout` option is in Node since 22.16.0 (`@types/node` `sqlite.d.ts`, `@since v22.16.0`), under the 22.19 floor. 10 s matches the opener's timeout in `test/store/helpers.ts` and is far inside the test's 30 s.

## Evidence

**Probe** (scratch, a temp file only, no Squeal store). It runs the old and new holder scripts. The parent process takes a SHARED lock after "held" (`BEGIN`, one `SELECT`) and keeps it over the holder's `COMMIT` at 500 ms, releasing it at 800 ms. This makes the rare overlap certain.

```
no busy timeout (base): exit 1 at 514 ms after "held"; reader released at 800 ms Error: database is locked
timeout: 10_000 (fix): exit 0 at 841 ms after "held"; reader released at 800 ms
```

Node 22.23.3 gives the same result (exit 1 at 511 ms; exit 0 at 846 ms). The fixed holder waits for the read lock and commits after it ends.

The holder part of the probe is `HOLD_WRITE_LOCK` with the open line changed. The reader part is:

```js
const reader = new DatabaseSync(file);
reader.exec("BEGIN");
reader.prepare("SELECT count(*) FROM sqlite_schema").get();
await new Promise((r) => setTimeout(r, 800));
reader.exec("COMMIT");
```

**Deliberate break** (reverted before the commit). The test's opener changed to never wait: `openStore(commonDir, { busyTimeoutMs: 0 })` in place of `open(commonDir)`, so it has no busy timeout and `switchToWal` has no retry time. With the holder fix in place, Squeal at revision 2:

```
Revision: 2 · 0885eec1 + 2, dirty
Selected: test/store/opening.test.ts
  FAIL  test/store/opening.test.ts > store opened by concurrent processes (task 001-207) > waits out a write lock another process holds when it switches the file into WAL
        database is locked (ERR_SQLITE_ERROR)
        at src/core/store/open.ts:176:60, observed at revision 2, current
Named test files at revision 2: 1 known failure: 1 test; 1 test file, each with a current result, after 3.6 s.
```

After the revert, at revision 3:

```
Revision: 3 · 0885eec1 + 3, dirty
Selected: test/store/opening.test.ts
Named test files at revision 3: no known failures; 1 test file, each with a current result, after 2.4 s.
```

So the busy timeout does not hide an opener that stops waiting.

## Commits

- e1054d39f `test(011-246): the WAL-switch test's lock holder waits out the opener's read lock at COMMIT`
- this notes file

## For the next worker

- The test still passes without testing anything if the opener reaches the switch after the holder commits, that is, if more than 500 ms pass between "held" and the switch (heavy load). The opener runs synchronously in the test process, so the test cannot signal the holder during the open. A stronger test needs the opener to report that it met the lock. This is outside this row.
