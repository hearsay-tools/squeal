import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCoverageWriter } from "../../../src/core/code/coverage/index.js";
import { commonDir, ON } from "../helpers.js";
import { type PayloadSet, payloads } from "./payloads.js";

/*
 * Row 015-42: the records' writer gives a job's main-thread time back
 * before the next job starts, so the change feed gets at least half of
 * every window; without a worker the whole map is the main thread's.
 */

/** How long one job's look for its result key takes, by the clock. */
const JOB_MS = 300;

let set: PayloadSet | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setImmediate", "Date"], now: 1_000 });
});
afterEach(() => {
  vi.useRealTimers();
  set?.cleanup();
  set = null;
});

describe("the records' writer's pace (row 015-42)", () => {
  it("starts a job no sooner than the job before took on the main thread", async () => {
    const own = payloads(2, 5);
    set = own;
    const files = [1, 2, 3].map((i) => own.file(`test/t${i}.test.ts`));
    const looked: number[] = [];
    const writer = createCoverageWriter({
      commonDir: commonDir(),
      format: "sha1",
      policy: () => ON,
      resultKey: (_run, testFile) => {
        looked.push(Date.now());
        vi.setSystemTime(Date.now() + JOB_MS);
        return `key-${testFile.path}`;
      },
      log: () => {},
      worker: null,
    });
    writer.collected({ runId: "run-1", files });
    await vi.advanceTimersByTimeAsync(1);
    expect(looked).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(JOB_MS - 2);
    expect(looked).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(looked).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10 * JOB_MS);
    await writer.idle();
    expect(looked).toHaveLength(3);
    const [first = 0, second = 0, third = 0] = looked;
    expect(second - first).toBeGreaterThanOrEqual(2 * JOB_MS);
    expect(third - second).toBeGreaterThanOrEqual(2 * JOB_MS);
    await writer.close();
  });
});
