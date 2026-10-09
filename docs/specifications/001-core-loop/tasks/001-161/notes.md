# 001-161: who held the store when a daemon's start exited (2026-10-09)

004 lessons defect 9: at 06:15:37.068 cezarion's daemon (worktree `7be860c1`) exited with "daemon exited: could not start: database is locked", while cezar's 0.1.55 and 0.1.56 daemons used the same store.

## Cause

Read from cezar's live store, read-only. `runs.ended_at` is written by the first statement in `recordTier`'s transaction, and `runs.started_at` by the first in `beginTier`'s, so each marks when that transaction held the write lock.

| start failure | holder's transaction began | gap |
| --- | --- | --- |
| 06:15:37.068, `7be860c1`, "could not start" | 06:15:32.034, `70903591` recording a tier of 4,165 results | 5.03 s |
| 07:03:00.652, `4da16ca6`, "could not start" | 07:02:55.611, `b7555ac0` (cezar's main worktree) beginning a tier | 5.04 s |
| 09:23:50.937, `bbb369e7`, "could not start serving" | not in `runs`; the same text as this test's red run (`#register`) | |

The daemon's busy timeout is 5 s, so each waiter gave up exactly when its timeout ran out behind a holder.

The holder is `Ledger.commit` (`src/core/scheduler/ledger.ts`). It called `sink.applyResults` once per applied file, and each call's `begin()` (`src/core/state/sink.ts`) lists every `known_states` and `test_file_keys` row of the worktree inside the write transaction. That is O(files × checks). `beginTier`'s commit refreshes the tier's files the same way, and a starting daemon's baseline lookup (`ledger.settle`) applies its hits per file, so a start can hold the lock long too.

The store has many more such notes, "daemon error: database is locked" and "scheduler stopped running tiers", from 2026-10-06 to today, 0.1.44's prune fix included. They fit this holder.

## Measurements (copy of cezar's store, 240 MB, transactions rolled back)

The largest run of each worktree, applied the old way (one `applyResults` per file) and the new way (one call):

| worktree | known states | files, results | per file (before) | merged (after) | `recordFailureKeys` per file / once |
| --- | --- | --- | --- | --- | --- |
| `70903591` | 4,982 | 198, 4,982 | 16.8 s, 10.9 s (load 127) | 183 ms, 87 ms | 187 ms, 6 ms / 20 ms, 5 ms |
| `b7555ac0` | 15,468 | 198, 5,133 | 59.3 s, 67.3 s (load 83 to 91) | 342 ms, 469 ms | 19 ms, 31 ms / 6 ms, 5 ms |

Bare `knownStates.list` and `testFileKeys.list`, 250 times in one transaction: 6.0 s (4,982 states) and 30.3 s (15,468), at load 43 to 54. The failure-keys step (004-25, asked about by the 004 coordinator) costs little either way: its meta row on this store holds few keys (1 and 15 failing results in these runs). Its once-per-call cost is now once per merged call.

## Fix

- `f42b002`: `Ledger.commit` merges consecutive applied entries of one checkpoint into one `applyResults` call. A check met again starts a new call, so states and transitions match what separate calls wrote. A commit now lists the worktree's states once per call it makes: apply, unknowns, refresh per checkpoint. `begin()` in `sink.ts` is unchanged. Caching its lists per transaction would have to follow every write between calls, for two or three lists a commit.
- `3d9eaa6`: the daemon opens the store with `DAEMON_START_BUSY_TIMEOUT_MS` (120 s) and sets `DAEMON_BUSY_TIMEOUT_MS` (5 s) once ready (`setBusyTimeout`, `src/core/store/open.ts`). The main thread may block that long. The socket answers from the front desk's worker thread, so hooks still see a starting daemon. A start that fails shuts down with the long timeout, so its shutdown writes (`setDaemon(null)`, the note) wait too.

## Tests

- `test/scheduler/commit-transaction.test.ts`: lists per commit (old: 26, 5, 251; new: 2, 4, 2); a check applied twice in one commit keeps both transitions; a 250-file, 5,000-result commit beside 15,000 states stays under 5 s (old: 29.3 s here).
- `test/daemon/busy-store.test.ts` with `long-writer.ts`: two writers hold the write lock 7 s at a time, resting 1 s between holds, and a daemon starts beside them three times in a row. Old: the first start exited with "could not start serving: database is locked". New: green, 179 s.

## Left open

- After ready the daemon still gives up after 5 s. With the holder fixed no measured hold comes near that. A long writer from elsewhere (another tool, an old daemon) would still cost a tier ("scheduler stopped running tiers"). Raising `DAEMON_BUSY_TIMEOUT_MS` would be a one-line change, and the socket thread makes it cheap. Not done: the row is the start.
- `worktrees.remove` and the 0.85 s idle prune (001-141 notes) are unchanged.
- Daemons from before this fix keep holding the lock for seconds until they step down.
