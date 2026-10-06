import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startTimers } from "../../src/core/daemon/lifecycle.js";
import { storePaths } from "../../src/core/store/index.js";
import { type Consumer, DEFAULT_POLICY } from "../../src/core/types/index.js";
import { acquireWaiterLock, waiterLockPath } from "../../src/core/waiter-lock/index.js";
import { fakeCommonDir, open } from "../store/helpers.js";
import { waitFor } from "./helpers.js";

const MIN = 60_000;
const WT = "0123456789abcdef";

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

describe("daemon expiry timer (D10, task 001-47)", () => {
  it("expires a consumer whose waiter is gone through the real timer and keeps the rest", async () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    const { locksDir } = storePaths(commonDir);
    mkdirSync(locksDir, { recursive: true });
    let clock = 1_000 * MIN;
    const gone: Consumer = { worktreeId: WT, sessionId: "gone", agentId: "main" };
    const headless: Consumer = { worktreeId: WT, sessionId: "headless", agentId: "main" };
    store.consumers.register(gone, clock);
    store.consumers.register(headless, clock);
    acquireWaiterLock(locksDir, gone)?.release(false);
    const shutdowns: string[] = [];

    stops.push(
      startTimers({
        root: dirname(commonDir),
        worktreeId: WT,
        commonDir,
        store,
        policy: DEFAULT_POLICY,
        now: () => clock,
        linkedDir: null,
        timings: { checkMs: 10, expireMs: 10, pruneMs: 60 * MIN, firstPruneMs: 60 * MIN },
        heartbeatMs: 60 * MIN,
        lastActive: () => clock,
        active: () => {},
        note: () => {},
        log: () => {},
        shutdown: (reason) => shutdowns.push(reason),
      }),
    );

    clock += 9 * MIN;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(store.consumers.get(gone)).not.toBeNull();

    clock += 2 * MIN;
    await waitFor(
      () => store.consumers.get(gone) === null,
      3_000,
      "the waiterless consumer expired",
    );
    expect(existsSync(waiterLockPath(locksDir, gone))).toBe(false);
    expect(store.consumers.get(headless)).not.toBeNull();
    expect(shutdowns).toEqual([]);
  });
});
