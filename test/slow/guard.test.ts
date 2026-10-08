import { describe, expect, test } from "vitest";
import { waitForCapacity } from "../../src/core/slow/index.js";

/** A clock that only moves when the guard sleeps, and a load that follows a script of [fromMs, load] steps. */
function host(steps: readonly (readonly [number, number])[], cpus = 4) {
  let at = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    deps: {
      cpus: () => cpus,
      load: () => {
        const step = steps.filter(([from]) => from <= at).at(-1);
        return [step?.[1] ?? 0, 0, 0];
      },
      now: () => at,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        at += ms;
      },
    },
  };
}

describe("waitForCapacity: the load guard (spec 004 D3)", () => {
  test("returns at once below the threshold", async () => {
    const { deps, sleeps } = host([[0, 3.9]]);
    const waited = await waitForCapacity({ maxLoadPerCpu: 1, maxDeferMs: 600_000, ...deps });
    expect(waited).toEqual({ waitedMs: 0, ranUnderLoad: null });
    expect(sleeps).toEqual([]);
  });

  test("returns at once at the threshold: only a load above it defers", async () => {
    const { deps } = host([[0, 4]]);
    const waited = await waitForCapacity({ maxLoadPerCpu: 1, maxDeferMs: 600_000, ...deps });
    expect(waited).toEqual({ waitedMs: 0, ranUnderLoad: null });
  });

  test("defers while above, rechecking every recheckMs, and returns once the load drops", async () => {
    const { deps, sleeps } = host([
      [0, 8],
      [40_000, 2],
    ]);
    const waited = await waitForCapacity({ maxLoadPerCpu: 1, maxDeferMs: 600_000, ...deps });
    expect(sleeps).toEqual([15_000, 15_000, 15_000]);
    expect(waited).toEqual({ waitedMs: 45_000, ranUnderLoad: null });
  });

  test("returns at the deferral bound with the load per CPU it runs under", async () => {
    const { deps, sleeps } = host([[0, 10]]);
    const waited = await waitForCapacity({
      maxLoadPerCpu: 1,
      maxDeferMs: 40_000,
      recheckMs: 15_000,
      ...deps,
    });
    // Never sleeps past the bound: the last wait is the 10 s left.
    expect(sleeps).toEqual([15_000, 15_000, 10_000]);
    expect(waited).toEqual({ waitedMs: 40_000, ranUnderLoad: 2.5 });
  });

  test("a load that drops exactly at the bound runs without a note", async () => {
    const { deps } = host([
      [0, 10],
      [30_000, 1],
    ]);
    const waited = await waitForCapacity({ maxLoadPerCpu: 1, maxDeferMs: 30_000, ...deps });
    expect(waited).toEqual({ waitedMs: 30_000, ranUnderLoad: null });
  });

  test("a spent deferral budget runs at once under load", async () => {
    const { deps, sleeps } = host([[0, 10]]);
    const waited = await waitForCapacity({ maxLoadPerCpu: 1, maxDeferMs: 0, ...deps });
    expect(sleeps).toEqual([]);
    expect(waited).toEqual({ waitedMs: 0, ranUnderLoad: 2.5 });
  });

  test("divides by at least one CPU", async () => {
    const { deps } = host([[0, 0.5]], 0);
    const waited = await waitForCapacity({ maxLoadPerCpu: 1, maxDeferMs: 600_000, ...deps });
    expect(waited).toEqual({ waitedMs: 0, ranUnderLoad: null });
  });

  test("defaults to the host's load and CPU count", async () => {
    const waited = await waitForCapacity({
      maxLoadPerCpu: Number.POSITIVE_INFINITY,
      maxDeferMs: 0,
    });
    expect(waited.ranUnderLoad).toBeNull();
    expect(waited.waitedMs).toBeLessThan(1000);
  });
});
