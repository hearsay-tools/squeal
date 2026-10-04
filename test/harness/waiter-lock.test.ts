import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MAIN_AGENT } from "../../src/core/types/index.js";
import {
  acquireWaiterLock,
  removeWaiterLock,
  waiterLockPath,
} from "../../src/harness/claude-code/waiter-lock.js";
import { tempDir } from "../store/helpers.js";

const consumer = { worktreeId: "0123456789abcdef", sessionId: "s", agentId: MAIN_AGENT };

/** Holds the lock file the way another waiter would. */
function hold(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA locking_mode = EXCLUSIVE");
  db.exec("BEGIN EXCLUSIVE");
  return db;
}

describe("waiter lock (review wave 3, N3)", () => {
  it("lets one waiter hold it and removes the file on release only when asked", () => {
    const dir = join(tempDir("squeal-locks-"), "locks");
    const lock = acquireWaiterLock(dir, consumer);
    expect(lock).not.toBeNull();
    expect(acquireWaiterLock(dir, consumer)).toBeNull();
    lock?.release(false);
    expect(existsSync(waiterLockPath(dir, consumer))).toBe(true);

    const again = acquireWaiterLock(dir, consumer);
    again?.release(true);
    expect(existsSync(waiterLockPath(dir, consumer))).toBe(false);
  });

  it("unlinks nothing another waiter holds", () => {
    const dir = join(tempDir("squeal-locks-"), "locks");
    const lock = acquireWaiterLock(dir, consumer);
    const path = waiterLockPath(dir, consumer);
    lock?.release(false);
    // A waiter that took the lock between the old holder's close and its unlink.
    const next = hold(path);
    try {
      removeWaiterLock(dir, consumer);
      expect(existsSync(path)).toBe(true);
    } finally {
      next.close();
    }
  });
});
