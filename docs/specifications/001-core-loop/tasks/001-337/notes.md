# 001-337 notes: the bad-config restart's `daemonReady` timeout

`test/e2e/lifecycle.test.ts` "a bad squeal.config.json > yields one note and a running daemon" timed out at 45 s in `e.daemonReady(e.main, first.pid)` five times on 2026-10-13, each time with no evidence. This row committed a diagnostic, captured one failure with it, and reproduced the failure deterministically through the shipped bundles. **The cause is a product fault, so the test is unchanged.** `squeal stop` reports a daemon stopped while that daemon still holds its worktree lock. A replacement spawned in that window loses the lock and exits silently, and nothing spawns another one until the next hook boundary.

## The diagnostic (`test/e2e/restart-evidence.ts`)

The case keeps the `stop` result and the third SessionStart's result, each with its time. Right after each one it lists this fixture's daemons, without blocking the next step:

- the lock file's holders from `/proc/locks`, read without taking the lock;
- `ps -o pid,ppid,stat,etime,pcpu,wchan:20,args`.

If `daemonReady` throws, the case prints one JSON object to stderr and appends it to the error message. The object holds those values, the processes at failure, `e.ping`, `e.status` (`daemon`, `revision`, `daemonNotes`), `lockFree` (the lock taken and released at once, only after the wait failed), `ls -laR .git/squeal`, `/proc/loadavg` and the kept fixture's path. `E2E.keep()` (`test/e2e/harness.ts`) makes cleanup leave the fixture's directory (`/tmp/squeal-e2e-XXXXXX`, about 43 MB). Cleanup still ends its sessions and stops and kills its daemons. The assertions are unchanged.

## The captured failure

Pinned loop run 8, codex harness, 20:23, load 33 to 35, 2 cores (`taskset -c 22,23`), with a full suite and two more loops running:

- `stop`: `Squeal daemon stopped`, code 0, after 1,230 ms.
- Right after the stop, the old daemon was still alive: `Dsl`, wchan `jbd2_log_wait_commit` (blocked on an ext4 journal commit), 8 s old.
- The third SessionStart took 1,601 ms. Its text said "A daemon is starting", so it had spawned a replacement.
- Right after that hook, and again at the failure 45 s later: no daemon process. Ping `null`, status `down`.
- `daemonNotes`: only the policy note and `daemon stopped: squeal stop`. The replacement wrote no note.
- Lock free at the failure.

## Why: the shutdown order, and how a hook-spawned daemon treats a held lock

- **What `squeal stop` waits on** (`src/cli/stop.ts`): it waits until a ping gets `ENOENT` or `ECONNREFUSED`, meaning the socket is gone.
- **The daemon's shutdown order** (`#shutdown`, `src/core/daemon/daemon.ts`): `store.close`, then the socket (`server.close` unlinks the file first), then `worker.terminate()`, then `lock.release()`, then the process exit. So the socket is gone before the lock is released. Usually that gap is a few milliseconds. Under I/O load the stopping daemon can stay in it for seconds, as in the D-state wait above.
- **What a hook-spawned replacement does** (`ensureDaemon` with no `awaitLockMs`): it tries the lock once (`acquireDaemonLock`, busy timeout 0). If another process holds it, the replacement exits `lost-lock` with code 0. Its stdio is ignored and it never opened the store, so it leaves no trace. Every exit after the store opens writes a note, so a replacement that vanishes with no note exited before the store.
- **Why nothing recovers**: nothing spawns again until the next hook boundary that ensures a daemon (PostToolBatch, Stop, the prompt hook, SessionStart). `daemonReady` only pings, so the test waits out its 45 s.

The bad-config policy plays no part. It is the only e2e case that runs `squeal stop` and then a SessionStart.

## Deterministic reproduction (scratch, not committed)

The scratch test froze the old daemon with `SIGSTOP` as soon as its socket file disappeared during `squeal stop`, which models the D-state stall. Then it ran SessionStart, sent `SIGCONT`, and waited 20 s for a ready replacement. The result was identical on both plugins:

- `/proc/locks` showed the old pid holding a WRITE lock before and after SessionStart.
- `stop` said stopped in 275 ms (claude-code) and 314 ms (codex).
- SessionStart said "A daemon is starting".
- No replacement ever held the lock or showed in `ps`.
- After `SIGCONT` the old daemon exited, the lock was free, and no daemon came up in 20 s.
- Notes: only `daemon stopped: squeal stop`.

## Run counts and load

| Runs | Setup | Load | Failed |
| --- | --- | --- | --- |
| 35 | Unpinned, beside one full suite | 15 to 44 | 0 |
| 19 | Pinned to cores 22 and 23 | 19 to 41 | 1 (run 8, above) |
| 16 | Two loops on core 23 alone | 33 to 44 | 0 |

That is 70 runs of both harnesses, with 1 failure.
The last loops were stopped once the cause was reproduced deterministically.

The gap between `stop` returning and the lock being free, measured by polling the lock right after `stop` and before any SessionStart: 15 of 15 already free at load 20. Pinned to 2 cores at load 32: 28 of 30 already free, 2 free 4 to 6 ms later. So the race needs a stall of several hundred milliseconds in the old daemon's last shutdown steps (the replacement's Node start, bundle load and `git rev-parse` come before its lock attempt). Disk I/O stalls under a loaded host supply that.

## For the product row (not done here)

Possible fixes, any one of which closes the window:

1. `squeal stop` reports stopped only once the lock is free or the process is gone. It could poll with `acquireDaemonLock` and release at once, or wait on the pid from the ping.
2. A hook-spawned daemon that loses the lock while the store records no live daemon (`setDaemon(null)` already ran) waits for the lock briefly, as a successor does (`awaitDaemonLock` with a `giveUp`).
3. A `lost-lock` exit leaves a trace, so a failure explains itself.

Changing the shutdown order (lock before socket) conflicts with D10's reason for the order: a successor must never see this daemon's socket go away after binding its own.

The test should stay as it is: it is the end-to-end check that catches this. A test-only wait for the old pid to exit before the SessionStart would hide the defect.
