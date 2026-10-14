# 001-356 notes: repair of review 001-351 (wave-13bj) B1

Review 001-351 proved one blocker against 001-350's post-acquire check. A waiter that took the lock read the worktree's last recorded daemon with the daemon's 5 s busy timeout and counted a failed read as no daemon recorded. The serving store open after it waits 120 s (`DAEMON_START_BUSY_TIMEOUT_MS`), so a store held exclusively for longer than 5 s and less than 120 s let a vacant or `--await-lock` waiter serve 0.1.156 over a recorded 999.0.0. 001-350's notes claimed the open after it "fails on the same store"; the longer timeout disproves that.

## Fix (`openDaemon`, `src/core/daemon/open.ts`)

A read of the last recorded daemon now has three outcomes (`LastDaemon`): a version, `null` (no daemon ever recorded on the row, or no store yet), or unread with the reason. Unread never counts as `null`.

- **Retry budget.** `lastDaemonVersion` reads again while the store is busy (`isBusy`: `SQLITE_BUSY`/`SQLITE_LOCKED`), each read waiting at most `DAEMON_BUSY_TIMEOUT_MS` (5 s), 10 ms apart, until `DAEMON_START_BUSY_TIMEOUT_MS` (120 s) has passed since the waiter took the lock. 120 s is the wait the serving open already had, so a store the open would have waited for is a store the decision waits for. It is an `openDaemon` parameter (`decideWithinMs`) so a test can shorten it; `startDaemon` does not expose it.
- **No store** (`missing`) is proven absence: the version is `null` and the start goes on to create the store, as before.
- **A newer schema** counts as no newer version recorded here, because the serving open right after refuses it with its existing note (`store-newer`, code 1) before any integrity check, creation or recovery. Nothing serves.
- **Unread at the bound, or unread for a reason other than busy** (a corrupt store, an I/O error): the waiter releases the daemon lock first, then exits the way D10's timed-out waits do: code 0, reason `lock-wait-timed-out`, and one note written best effort without the lock (`lockWaitTimedOut`, the same 5 s busy timeout; a store still unreadable gets none and the exit message says it). Text: "a daemon gave up: it took the lock but could not read the last daemon recorded within N ms (reason); the next hook boundary starts one". A corrupt store therefore exits without recovering it; the next boundary's spawn finds the lock free, takes it at once and runs D12's recovery as any first start does.
- **Kept.** A recorded newer version: `lost-lock`, code 0, no note. Same version or older: serves (the accepted same-version residue). A daemon that takes the lock on its first try makes no decision and is unchanged. The 250 ms in-wait checks keep their 100 ms read, and an unread there still means "keep waiting", which never serves. Lock attempts stay on fresh connections. Hooks still spawn detached and never wait. The finite budgets stay finite: the decision adds at most 120 s, only after a wait ended with the lock, while holding it; a start that runs into it on the vacant path waits its 30 s and times out with its note.

**Decision not settled by the spec: the exit reason.** I reused `lock-wait-timed-out` rather than adding a `DaemonExitReason`: the waiter's purpose (take the lock and know it may serve) ended without an answer, the behaviour the brief asked to match is exactly that reason's (code 0, one note, the next boundary starts one), and nothing switches on reasons exhaustively. The type's doc comment ("found the lock still held") is now narrower than its uses; `src/core/types/daemon.ts` is outside this row, so it is unchanged. If the coordinator prefers a distinct reason (say `version-unread`), it is a one-line additive type change plus the `exit` call.

## Tests (`test/daemon/vacant-wait.test.ts`, "a lock waiter that cannot yet read the last recorded daemon")

The contention is the reviewer's probe rebuilt in-test: a child Node process holds the fixture store with `locking_mode=EXCLUSIVE` and `BEGIN EXCLUSIVE` (WAL kept) for `DAEMON_BUSY_TIMEOUT_MS + 2 s`; the fixture holds the daemon lock and releases it at 50 ms. A cleared 999.0.0 record is planted first. The probe script itself was not run.

| Test | Before (88c3b0bf^) | After |
| --- | --- | --- |
| vacant waiter, store busy past the first read, readable later | served (a running daemon) | `lost-lock`, code 0, no note, lock free after, took ≥ 5 s |
| `--await-lock` waiter, the same | served | the same |
| `openDaemon` with `decideWithinMs` 1 s, store busy 2.5 s | `lost-lock` (the old 5 s read outlasted the hold) | `lock-wait-timed-out`, code 0, message "could not read", one note, lock free after |

The ≥ 5 s assertion is the premise: it proves the first read under the lock found the store busy, so the first two tests cannot pass on a read that happened after the hold ended.

## For the coordinator

- `src/core/daemon/open.ts` is under the key-format guard: `test/keys/key-format.test.ts` fails until `KEY_FORMAT_VERSION` is bumped and the new hash pinned (the test names it). Left to the coordinator per the brief.
- `plugins/*/dist/cli/squeal.mjs` were regenerated by `npm run build` and committed with this row.

## Draft D10 amendment (for the coordinator to apply)

Append after the 001-350 sentence "…and exits as a loser, with no note, while that daemon is newer than itself: …(review 001-347, B2).":

> A read of that daemon that fails proves nothing and never counts as no daemon recorded: the waiter reads again while the store is busy, each read with the daemon's 5 s busy timeout, for at most 2 minutes, the wait the store open after it has; a missing store is no daemon recorded and a newer schema goes on to that open's refusal. A waiter that still cannot read it releases the lock before any integrity check, creation or recovery of the store and exits like a timed-out wait, with one note and code 0 and reason `lock-wait-timed-out`, and the next hook boundary starts one (review 001-351, B1).

## Draft status line

- 2026-10-14, 001-356 (repair of review 001-351 B1 on 001-350; `tasks/001-356/notes.md`; the exit reason chosen by the worker): D10 amended. A lock waiter, vacant or `--await-lock`, that takes the lock and cannot read the last recorded daemon no longer counts it as absent: it reads again while the store is busy, up to the store open's 2 minutes, and otherwise releases the lock before opening the store and exits code 0, `lock-wait-timed-out`, with one note. Regressions for both modes with a store busy past the first read.
