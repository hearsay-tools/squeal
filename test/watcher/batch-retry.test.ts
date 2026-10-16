import { describe, expect, it } from "vitest";
import { BatchRetries, type BatchRetry } from "../../src/core/watcher/batch-retry.js";

/*
 * Task 001-422: a batch that failed on a busy store is retried as a pass, at
 * once, then with backoff, until one lands; a close during a delay ends it.
 */

const busy = () => Object.assign(new Error("database is locked"), { errcode: 5 });
const isBusy = (error: Error) => (error as { errcode?: number }).errcode === 5;

function retries(delayMs: (attempt: number) => number) {
  const errors: Error[] = [];
  let ran = 0;
  const retry: BatchRetry = { accepts: isBusy, delayMs, ran: () => ran++ };
  return {
    retries: new BatchRetries(retry, (error) => errors.push(error)),
    errors,
    ran: () => ran,
  };
}

describe("a batch retried on a busy store (001-422)", () => {
  it("runs the pass at once, again after each delay, until it lands", async () => {
    const delays: number[] = [];
    const t = retries((attempt) => {
      delays.push(attempt);
      return 5;
    });
    let passes = 0;
    await t.retries.failed(busy(), async () => {
      passes++;
      if (passes < 3) throw busy();
    });
    expect(passes).toBe(3);
    expect(delays).toEqual([0, 1, 2]);
    expect(t.ran()).toBe(1);
    expect(t.errors).toEqual([]);
  });

  it("reports any other error, and a retry's other error after it ran", async () => {
    const t = retries(() => 0);
    let passes = 0;
    await t.retries.failed(new Error("git failed"), async () => {
      passes++;
    });
    expect(passes).toBe(0);
    expect(t.errors.map((e) => e.message)).toEqual(["git failed"]);

    await t.retries.failed(busy(), async () => {
      throw new Error("disk full");
    });
    expect(t.ran()).toBe(1);
    expect(t.errors.map((e) => e.message)).toEqual(["git failed", "disk full"]);
  });

  it("ends with a close during a delay, with no pass after it", async () => {
    const t = retries((attempt) => (attempt === 0 ? 0 : 60_000));
    let passes = 0;
    const failing = t.retries.failed(busy(), async () => {
      passes++;
      throw busy();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const start = performance.now();
    t.retries.close();
    await failing;
    expect(performance.now() - start).toBeLessThan(1_000);
    expect(passes).toBe(1);
    expect(t.ran()).toBe(0);
    expect(t.errors).toEqual([]);
  });
});
