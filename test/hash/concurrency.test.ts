import { describe, expect, it } from "vitest";
import { mapConcurrent } from "../../src/core/hash/index.js";

describe("mapConcurrent", () => {
  it("keeps input order and never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    const results = await mapConcurrent(
      Array.from({ length: 50 }, (_, i) => i),
      async (n) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, (n * 7) % 5));
        running--;
        return n * 2;
      },
      4,
    );
    expect(results).toEqual(Array.from({ length: 50 }, (_, i) => i * 2));
    expect(peak).toBe(4);
  });

  it("returns an empty array for no items", async () => {
    expect(await mapConcurrent([], async () => 1)).toEqual([]);
  });

  it("rejects with the first error", async () => {
    await expect(
      mapConcurrent([1, 2, 3], async (n) => {
        if (n === 2) throw new Error("boom 2");
        return n;
      }),
    ).rejects.toThrow("boom 2");
  });
});
