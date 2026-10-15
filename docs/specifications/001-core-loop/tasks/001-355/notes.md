# 001-355 (and 001-408): the daemon holds its own gap open

`test/daemon/handover-gap.test.ts` and `test/e2e/stop-gap.test.ts` spun until
the daemon's socket was gone, then sent it SIGSTOP. Neither the spin nor the
signal is atomic with the daemon's next step, its lock release, so on a loaded
host the lock was sometimes gone before `/proc/locks` was read (`expected
'none' to match /WRITE\s+<pid>\s/`). 001-408 is the same miss in the e2e test.

## The hook

`src/core/daemon/test-pause.ts`, `pauseAt(point)`: with
`SQUEAL_TEST_PAUSE=<point>` in its environment the daemon sends itself SIGSTOP
at that point; the test resumes it with SIGCONT. Any other value, or none,
does nothing. Two points:

- `stop-gap`, in `Daemon#shutdown` between the `socket close` step and the
  `lock release` step: socket unlinked, lock still held.
- `lock-wait`, in `awaitDaemonLock` after the first failed retry and the
  give-up check after it.

Only the daemon under test gets the variable: `stepDownKit.start` and
`E2E.hook` take an optional `env` added to the fixture's for that one spawn.

## Why a second point

Run 18 of the first 30-run loop failed in the second handover case at "the
successor at the lock": the test caught the successor's lock retry through
`/proc/<pid>/fd`, but each retry holds the file open for well under a
millisecond every 10 ms, and on two CPUs beside two busy loops the spinning
test missed it for 30 s. That case needs the successor frozen inside its wait
(past its first retry and the check, which saw no record), so it now stops
itself there with `lock-wait`. Same remedy, same file, so it is part of this
row rather than a new one.

## The tests

Both wait for `T` in `/proc/<pid>/stat` (`stoppedItself` in
`test/e2e/restart-evidence.ts`), then assert the socket is gone and the lock is
held by that pid before the waiters start. Every successor and next-boundary
assertion is unchanged; no timeout was lengthened and nothing retries.

The e2e test runs the plugin's built `dist`: it needs the coordinator's rebuild
of `plugins/*/dist` to carry `pauseAt`. Before that rebuild it fails at "the
daemon stopped in its stop gap" (the daemon exits instead of stopping). With a
local rebuild (not committed) it passed for both plugins.
