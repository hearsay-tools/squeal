# 001-350 notes: repair of review 001-347 (wave-13bh) on 001-340 and 001-345

Review 001-347 proved two blockers against amended D10. This row fixes both. Each has a committed regression that was red before its fix and is green after. S1 (status history) and N1 (board) are the coordinator's.

## B1: a lock directory the CLI cannot search read as a free lock

`lockFreed` in `src/cli/stop.ts` returned `free` on `!existsSync(path)`. Node's `existsSync` is false when the lock file is missing, but also when a directory above it has no search permission. The reviewer ran `chmod 000` on `locks/`, and `stop` said stopped while the live pid held the lock.

**Fix.** The path counts as missing only when `lstat` fails with `ENOENT` or `ENOTDIR` (`lstatOrNull`, `isMissing`). Any other lookup error proves nothing. The loop then probes the lock. The probe cannot open it either, so it reports `unchecked`, while the pid and the replacement record can still prove the lock was released.

**The brief's "parent directory is readable" check is not added.** On POSIX, `lstat` returns `ENOENT` only after it has searched every ancestor, so an inaccessible ancestor gives `EACCES` and never `ENOENT`. A missing ancestor gives `ENOENT`, and that is real absence: nothing holds a lock there. A parent `readdir` would add a second way to fail without adding any proof.

| Test (`test/cli/stop-lock.test.ts`, "a lock directory it cannot search") | Red before | Green after |
| --- | --- | --- |
| `lockFreed` with the lock held, the pid alive, no record, `locks/` at mode 000, 200 ms | `{state: "free"}` | `unchecked` with the error; also with no pid |
| `squeal stop` with the same setup; the ping names a child killed at 600 ms | said stopped in 3.2 ms | waits ≥ 550 ms, then stopped |

Both tests restore the directory's mode in `finally`.

## B2: a waiter took the lock after its version decision went stale

`awaitDaemonLock` (`lock.ts`) retries the lock every 10 ms but calls `giveUp` only every 250 ms. It returns as soon as it takes the lock, so an acquisition is never followed by a check. A vacant-lock waiter (`open.ts`) checked once and found no record. A newer daemon then registered, stopped and released the lock. The waiter took the lock on its next attempt and served the older version.

**Fix** (`openDaemon`, `src/core/daemon/open.ts`). A waiter that takes the lock through `awaitDaemonLock` now reads the worktree's last recorded daemon once more (`newerRecorded`: `worktrees.lastDaemon`, cleared or not) before it opens the store. If that daemon is newer than itself, the waiter releases the lock and exits as an ordinary loser: `lost-lock`, code 0, no note. This read is final because nothing can register while the waiter holds the lock. It uses the daemon's 5 s busy timeout; the 250 ms checks keep 100 ms. When the read fails, it counts as no record, as the checks already do, and the store open that follows fails on the same store.

The check does not apply to a daemon that takes the lock on its first try. That daemon made no earlier decision that could go stale, and it is D10's existing first-start case.

**The `--await-lock` successor had the same gap, and it is closed the same way.** `takenOver` reads only `recordedDaemon`, the record that still names a socket. Once a newer daemon clears its record, the successor no longer sees it. Without the final check, a successor that takes the lock after a newer daemon ran and stopped serves the older version. With it, the successor exits as a loser. In a normal step-down the last recorded daemon is the old one, which is older than the successor (a step-down is accepted only for a strictly newer hook), so the successor still serves.

**The same-version residue is unchanged.** A waiter of the stopping daemon's own version finds a version that is not newer than its own, so it serves. The regression pins this case, and `handover-gap.test.ts` still pins the case with the successor.

| Test (`test/daemon/vacant-wait.test.ts`, on `startDaemon`) | Red before | Green after |
| --- | --- | --- |
| The vacant waiter's first check finds no record. Before its next attempt, a 999.0.0 daemon registers, clears its record and releases the lock | served (`RunningDaemon`) | `lost-lock`, code 0, no note, lock released |
| Same, with a daemon of the waiter's own version | serves | serves (accepted residue) |
| A successor (`awaitLockMs: 5000`) whose last recorded daemon, cleared, is 999.0.0; the lock is released at 300 ms | served | `lost-lock`, code 0, no note |

**How the test replaces the reviewer's SIGSTOP.** The test injects a `now` clock instead of SIGSTOPping a child process. The first call to `now` comes from the waiter's first check (`liveDaemonRecorded(root, now())`), which runs after its first failed attempt. That call schedules the registration, the clear and the release with `setImmediate`. They run during the waiter's 10 ms sleep, before its next attempt and long before its next check at 250 ms. The order is the probe's: check before the registration, acquisition after the shutdown. It does not depend on timing under load.

## Key format

`open.ts` is a guarded source. Format 9 is unreleased, so it is re-pinned again to `120a40e49325b49f482849a608c551da73777a0cadfb95c47be99654a451c4a7`. `src/cli/stop.ts` is exempt.

## Types

No type change. `newerRecorded` is module-private, and `lastDaemonVersion` takes an added busy-timeout parameter. `LockCheck` is unchanged.

## Draft D10 amendment (for the coordinator)

In D10's first paragraph, after "...and at its bound persists one note and exits with code 0 and reason `lock-wait-timed-out`.", insert:

> A waiter, this one or a successor (below), that takes the lock reads the last daemon the worktree's row records once more before it opens the store, and exits as a loser, with no note, while that daemon is newer than itself: its checks run between attempts, so a waiter descheduled across a newer daemon's registration and shutdown would otherwise take the lock that daemon freed, and nothing registers while it holds the lock (review 001-347, B2).

In the `squeal stop` sentence, replace "a probe that cannot open the lock proves nothing." with:

> a probe that cannot open the lock proves nothing, and the lock file is gone only when its lookup says it is missing, not when a directory above it cannot be searched (review 001-347, B1).

`status.md` line:

> - 2026-10-13, 001-350 (repair of review 001-347 on 001-340 and 001-345; `tasks/001-350/notes.md`): D10 amended. `squeal stop` counts the lock file as gone only when its lookup says it is missing (`ENOENT`/`ENOTDIR`), so a lock directory it cannot search makes the probe report the lock unchecked, never free (B1). A lock waiter, vacant or `--await-lock`, that takes the lock reads the worktree's last recorded daemon again before it opens the store, and exits as a loser with no note while that daemon is newer than itself, so a waiter descheduled across a newer daemon's registration and shutdown never serves the older version (B2). The same-version residue stays accepted. No type or schema change. Key format 9 re-pinned (unreleased). Evidence: `test/cli/stop-lock.test.ts`, `test/daemon/vacant-wait.test.ts`.

## Seam map (for whoever continues)

- Every lock wait goes through `awaitDaemonLock`, and its acquisitions are never checked. Any new decision a waiter makes belongs in `openDaemon` after the wait returns, not only in `giveUp`.
- `recordedDaemon` (`ensure.ts`) sees only a record with a socket. `worktrees.lastDaemon` also sees a cleared record. The successor's `takenOver` uses the first, and the post-acquire check uses the second.

## Verification

These runs used bundles rebuilt from this row's sources (`npm run build`) and left uncommitted, because the e2e cases run the shipped bundles. The coordinator commits the rebuild. `npm ci` ran first.

- **Each regression, before and after its fix:** both B1 tests and both B2 vacant/successor tests failed before their fixes (table above) and pass after them.
- **The named files**, in one run: `test/cli/stop-lock`, `daemon/open`, `daemon/lock-wait`, `daemon/handover`, `daemon/handover-gap`, `daemon/step-down`, `daemon/server-handover`, `daemon/socket-handover`, `daemon/vacant-wait`, `daemon/lifecycle`, `harness/ensure`, `e2e/stop-gap` (both plugins) and `keys/key-format`. Result: 13 files, 88 tests passed.
- **The bad-config case** (`test/e2e/lifecycle.test.ts -t "bad squeal.config"`, both plugins): 10 runs in a row, 10 passed, at load 16 to 27, beside full suite 1.
- **Full suite 1** (`npx vitest run --maxWorkers=4`, 23:29): 468 files passed, 1 failed, 1 skipped; 3,943 tests passed, 1 failed, 10 skipped; 719 s.
  - The failure: `test/daemon/slow-lane.test.ts:57` read `''` from a file it had just seen exist. The read can land between the file's creation and its write.
  - Load reached 56 during this run, under another coordinator's gate suite and a 005 real-CLI hold.
  - Run alone afterwards, the file passed.
- **Full suite 2** (23:42): 468 files passed, 1 failed, 1 skipped; 3,943 tests passed, 1 failed, 10 skipped; 506 s.
  - The failure: `test/scheduler/touched.test.ts:104`, "waits as one call while the runner work before it waits". It is an order-of-batching assertion.
  - It passed 3 runs in a row alone afterwards.
  - This row did not touch the scheduler.
- **Neither full-suite failure** is a known load timeout. Neither touches a lock path. Neither one recurred in the other run.
- **Squeal's full-suite checkpoint** (`squeal run --all --wait`, Squeal 0.1.131): completed at revision 7, `Known failures: 0`, 4,414 passed, 10 skipped.
- **Lint and typecheck:** `npm run lint` clean (1006 files); `npm run typecheck` exit 0.
