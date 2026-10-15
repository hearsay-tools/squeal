/** Where a daemon run with `SQUEAL_TEST_PAUSE` stops itself (task 001-355). */
export type TestPause = "stop-gap" | "lock-wait";

/**
 * Test-only (task 001-355): with `SQUEAL_TEST_PAUSE=<point>` a daemon stops
 * itself with SIGSTOP at that point, and a test resumes it with SIGCONT.
 * `stop-gap` is between a shutdown's socket unlink and its lock release
 * (D10's order), so the lock is still held; `lock-wait` is a successor's lock
 * wait after its first failed retry and the check after it. A SIGSTOP the
 * test sends once it sees the unlink, or the lock file open, races the
 * daemon's next step (review wave-13bj S1); this one cannot.
 */
export function pauseAt(point: TestPause, env: NodeJS.ProcessEnv = process.env): void {
  if (env.SQUEAL_TEST_PAUSE === point) process.kill(process.pid, "SIGSTOP");
}
