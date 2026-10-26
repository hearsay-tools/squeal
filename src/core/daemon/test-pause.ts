import { channel } from "node:diagnostics_channel";

/** Where a daemon, or `squeal stop`, tells a test it may pause it (task 001-355). */
export type TestPause = "stop-gap" | "lock-wait" | "stop-mark" | "store-open";

/** The channel a test's preload subscribes to (`test/daemon/pause-preload.mjs`). */
const TEST_PAUSE_CHANNEL = "squeal:test-pause";

const pauses = channel(TEST_PAUSE_CHANNEL);

/**
 * Test-only (task 001-355): publishes `point` to `TEST_PAUSE_CHANNEL`; with
 * no subscriber it does nothing, so the shipped CLI never stops itself
 * (review 001-423, N1). A test's preload, loaded with `node --import`,
 * subscribes and stops the daemon with SIGSTOP there, synchronously, and the
 * test resumes it with SIGCONT. `stop-gap` is between a shutdown's socket
 * unlink and its lock release (D10's order), so the lock is still held;
 * `lock-wait` is a successor's lock wait after its first failed retry and the
 * check after it. A SIGSTOP the test sends once it sees the unlink, or the
 * lock file open, races the daemon's next step (review wave-13bj S1); this
 * one cannot. `stop-mark` is `squeal stop` once it saw the socket go and
 * before it leaves the stopped mark (row 011-20). `store-open` is a start
 * once it holds the lock and opened the store, before its socket and its
 * record: a start slower than its hook (row 011-250).
 */
export function pauseAt(point: TestPause): void {
  if (pauses.hasSubscribers) pauses.publish(point);
}
