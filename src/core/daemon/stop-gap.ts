/**
 * Test-only (task 001-355): with `SQUEAL_TEST_STOP_GAP=1` a stopping daemon
 * stops itself with SIGSTOP between its socket's unlink and its lock release
 * (D10's order), so a test holds that gap open with the lock still held and
 * resumes it with SIGCONT. A SIGSTOP the test sends after it sees the unlink
 * races the release (review wave-13bj S1); this one cannot.
 */
export function pauseInStopGap(env: NodeJS.ProcessEnv = process.env): void {
  if (env.SQUEAL_TEST_STOP_GAP === "1") process.kill(process.pid, "SIGSTOP");
}
