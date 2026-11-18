import { utimesSync } from "node:fs";
import { afterEach } from "vitest";
import { acquireDaemonLock, type DaemonLock } from "../../src/core/daemon/lock.js";
import { markStart } from "../../src/core/presence/lock-events.js";
import { startMarkFor } from "../../src/core/presence/marks.js";
import type { AbsolutePath } from "../../src/core/types/common.js";

/*
 * Row 005-121: the one fixture for "take the lock and mark the start". Every lock it takes is
 * released after each test; a test may release one sooner (a release is idempotent).
 */

const held: DaemonLock[] = [];
afterEach(() => {
  for (const lock of held.splice(0)) lock.release();
});

/**
 * Takes the daemon lock at `lockFile` and marks its start, as a starting daemon does in
 * `openDaemon` before its store check. With `at` (epoch ms), the mark's time is `at`, which
 * readers take as the start's.
 */
export function holdStart(lockFile: AbsolutePath, at?: number): DaemonLock {
  const taken = acquireDaemonLock(lockFile);
  if (taken === null) throw new Error("the lock is taken");
  const lock = markStart(lockFile, taken);
  held.push(lock);
  if (at !== undefined) utimesSync(startMarkFor(lockFile), at / 1000, at / 1000);
  return lock;
}
