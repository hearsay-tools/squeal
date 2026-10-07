import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { mapConcurrent } from "../../src/core/fs/index.js";

describe("mapConcurrent", () => {
  it("keeps input order while calls finish out of order", async () => {
    const out = await mapConcurrent([30, 10, 20, 0], async (ms, i) => {
      await delay(ms);
      return `${i}:${ms}`;
    });
    expect(out).toEqual(["0:30", "1:10", "2:20", "3:0"]);
  });

  it("never has more than the limit in flight, and uses all of it", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapConcurrent(
      Array.from({ length: 50 }, (_, i) => i),
      async (i) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await delay(i % 3);
        inFlight--;
      },
      8,
    );
    expect(peak).toBe(8);
  });

  it("accepts any iterable and returns an empty array for no items", async () => {
    expect(await mapConcurrent(new Set(["a", "b"]), async (s) => s.toUpperCase())).toEqual([
      "A",
      "B",
    ]);
    expect(await mapConcurrent([], async () => 1)).toEqual([]);
  });

  it("rejects with the first error", async () => {
    await expect(
      mapConcurrent([1, 2, 3], async (n) => {
        if (n === 2) throw new Error("two");
        return n;
      }),
    ).rejects.toThrow("two");
  });
});
