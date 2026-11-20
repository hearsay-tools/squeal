import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { acquireDaemonLock } from "../../src/core/daemon/lock.js";
import {
  storeProcessLockPath,
  storeProcessSocketPath,
} from "../../src/core/store-process/paths.js";
import { release } from "../../src/core/store-process/release.js";
import {
  type RunningStoreProcess,
  STORE_PROCESS_GRACE_MS,
  startStoreProcess,
} from "../../src/core/store-process/server.js";
import type { AbsolutePath, WorktreeId } from "../../src/core/types/common.js";
import { type Clone, clone, gatedWriter } from "./helpers.js";

/*
 * Spec 021 D22.2, review of the rebuild B1: a daemon stopped on purpose
 * while its store process still starts (lock held, no socket yet) tells
 * it once it serves, so that process stops instead of waiting its grace.
 */

const clones: Clone[] = [];
afterEach(async () => {
  for (const at of clones.splice(0)) await at.cleanup();
});

describe("a leaving relay's release", { timeout: 30_000 }, () => {
  it.each([
    ["serving already", false],
    ["still starting", true],
  ])("stops a store process %s, its last client gone", async (_name, starting) => {
    const at = clone();
    clones.push(at);
    const writer = gatedWriter(at.commonDir);
    const started = startStoreProcess({
      commonDir: at.commonDir as AbsolutePath,
      log: () => {},
      writer: { script: writer.script },
      env: at.env,
      graceMs: STORE_PROCESS_GRACE_MS,
      checkMs: 60_000,
    });
    at.later(async () => {
      writer.open();
      const end = await started;
      if (typeof end !== "string") await end.stop();
    });
    const socketPath = storeProcessSocketPath(at.commonDir as AbsolutePath, "code", at.env);
    let running: RunningStoreProcess | null = null;
    if (!starting) {
      writer.open();
      running = (await started) as RunningStoreProcess;
    }
    expect(acquireDaemonLock(storeProcessLockPath(at.commonDir, "code"))).toBeNull();
    expect(existsSync(socketPath)).toBe(!starting);

    const target = {
      commonDir: at.commonDir as AbsolutePath,
      worktreeId: "w1" as WorktreeId,
      socketPath,
    };
    const released = release(target, null, true);
    if (starting) {
      setTimeout(writer.open, 100);
      running = (await started) as RunningStoreProcess;
    }
    await released;
    expect(typeof running).toBe("object");
    const ended = await Promise.race([
      running?.ended,
      new Promise((resolve) => setTimeout(resolve, 5_000, "still serving")),
    ]);
    expect(ended).toBe("stopped");
  });

  it("returns at once when no store process holds the lock", async () => {
    const at = clone();
    clones.push(at);
    const target = {
      commonDir: at.commonDir as AbsolutePath,
      worktreeId: "w1" as WorktreeId,
      socketPath: storeProcessSocketPath(at.commonDir as AbsolutePath, "code", at.env),
    };
    const begun = performance.now();
    await release(target, null, true);
    expect(performance.now() - begun).toBeLessThan(1_000);
  });
});
