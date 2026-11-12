import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileProgress, type Overrun, overrunFloor } from "../../../src/core/code/gate/progress.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";

/*
 * Spec 020 row 020-43 (#196): a file that runs past its estimate is named
 * once while it still runs; one that ends first, or after the runs ended,
 * is not. The estimate is its stored seconds, never under the floor.
 */

const SLOW: TestFileRef = { project: "slow", path: "test/n1/slow.test.mjs" };
const QUICK: TestFileRef = { project: "", path: "test/v/quick.test.ts" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});
afterEach(() => {
  vi.useRealTimers();
});

function progress(durations?: (ref: TestFileRef) => number | null) {
  const told: Overrun[] = [];
  const files = new FileProgress({
    budgetSeconds: 600,
    since: performance.now(),
    durations,
    overran: (file) => told.push(file),
  });
  return { files, told };
}

describe("FileProgress", () => {
  it("names a file once when it runs past its stored seconds", () => {
    const { files, told } = progress((ref) => (ref === SLOW ? 207 : null));
    vi.advanceTimersByTime(5_000);
    files.started("node-test", SLOW);

    vi.advanceTimersByTime(206_000);
    expect(told).toEqual([]);
    vi.advanceTimersByTime(2_000);
    vi.advanceTimersByTime(600_000);

    expect(told).toEqual([
      {
        runner: "node-test",
        path: SLOW.path,
        seconds: 207,
        storedSeconds: 207,
        usedSeconds: 212,
        budgetSeconds: 600,
      },
    ]);
  });

  it("waits for the floor when the stored seconds are less or none", () => {
    expect(overrunFloor(600)).toBe(30);
    expect(overrunFloor(25)).toBe(10);
    const { files, told } = progress((ref) => (ref === QUICK ? 2 : null));
    files.started("vitest", QUICK);
    files.started("node-test", SLOW);
    vi.advanceTimersByTime(29_000);
    expect(told).toEqual([]);
    vi.advanceTimersByTime(1_000);
    expect(told.map((t) => [t.path, t.seconds, t.storedSeconds])).toEqual([
      [QUICK.path, 30, 2],
      [SLOW.path, 30, null],
    ]);
  });

  it("does not name a file that ended, or once the runs ended", () => {
    const { files, told } = progress();
    const ended = files.started("vitest", QUICK);
    files.started("node-test", SLOW);
    vi.advanceTimersByTime(20_000);
    ended();
    files.close();
    vi.advanceTimersByTime(600_000);
    files.started("node-test", { project: "slow", path: "test/n1/late.test.mjs" });
    vi.advanceTimersByTime(600_000);
    expect(told).toEqual([]);
  });

  it("knows which files started, by runner and project", () => {
    const files = new FileProgress({ budgetSeconds: 25, since: performance.now() });
    files.started("node-test", SLOW);
    expect(files.wasStarted("node-test", SLOW)).toBe(true);
    expect(files.wasStarted("vitest", { ...SLOW, project: "" })).toBe(false);
    expect(files.wasStarted("node-test", { ...SLOW, project: "quick" })).toBe(false);
  });
});
