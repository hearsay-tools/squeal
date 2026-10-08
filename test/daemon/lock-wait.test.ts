import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireDaemonLock, awaitDaemonLock } from "../../src/core/daemon/lock.js";
import { tempDir } from "../store/helpers.js";

/*
 * Task 001-130: the successor a step-down spawns waits for the old daemon's
 * lock instead of losing it at once, gives up when another daemon took
 * over, and stops waiting after its bound. In one process: SQLite's
 * exclusive locking mode refuses a second connection here too.
 */

const lockPath = () => join(tempDir(), "locks", "abc.sqlite");

describe("awaitDaemonLock", () => {
  it("takes the lock once its holder releases it, and holds it until released", async () => {
    const path = lockPath();
    const old = acquireDaemonLock(path);
    setTimeout(() => old?.release(), 150);
    const at = performance.now();
    const lock = await awaitDaemonLock(path, { timeoutMs: 5_000, giveUp: () => false });
    expect(lock).not.toBeTypeOf("string");
    expect(performance.now() - at).toBeGreaterThanOrEqual(140);
    expect(acquireDaemonLock(path)).toBeNull();
    if (typeof lock !== "string") lock.release();
    acquireDaemonLock(path)?.release();
  });

  it("is the lock at once when nobody holds it", async () => {
    const lock = await awaitDaemonLock(lockPath(), { timeoutMs: 0, giveUp: () => true });
    expect(lock).not.toBeTypeOf("string");
    if (typeof lock !== "string") lock.release();
  });

  it("gives up when asked to, and times out at its bound, leaving the holder's lock alone", async () => {
    const path = lockPath();
    const holder = acquireDaemonLock(path);
    let asked = 0;
    const giveUp = () => ++asked > 2;
    expect(await awaitDaemonLock(path, { timeoutMs: 5_000, giveUp, checkMs: 20 })).toBe("gave-up");
    const at = performance.now();
    expect(await awaitDaemonLock(path, { timeoutMs: 200, giveUp: () => false })).toBe("timed-out");
    expect(performance.now() - at).toBeGreaterThanOrEqual(190);
    expect(acquireDaemonLock(path)).toBeNull();
    holder?.release();
    acquireDaemonLock(path)?.release();
  });
});
