import { describe, expect, it } from "vitest";
import { LATE_FACTOR, lateBoundMs, median } from "../../src/core/delivery/late-bound.js";

/*
 * Row 005-93, part 1 (design section 1): results for the consumer's edits are late when the
 * oldest owed edit is older than `2 × (start + Σ over tiers of (overhead + wallEstimate(tier)))`.
 */

describe("the late bound (row 005-93, design section 1)", () => {
  it("is twice the durations alone before any stored run", () => {
    // One tier of one 1.7 s file: wallEstimate(1700, 1700, 1) = 1700.
    expect(lateBoundMs({ durations: [1_700], tierSize: 4, startMs: 0, overheadMs: 0 })).toBe(3_400);
  });

  it("adds the measured start once and the overhead once per tier", () => {
    // Five files at tierSize 4, shortest first: [1, 2, 3, 4] s and [10] s.
    // Tier 1: wallEstimate(10000, 4000, 4) = 2500 + 0.75 × 4000 = 5500. Tier 2: 10000.
    // 2 × (10000 + (1600 + 5500) + (1600 + 10000)) = 57400.
    const bound = lateBoundMs({
      durations: [10_000, 4_000, 3_000, 2_000, 1_000],
      tierSize: 4,
      startMs: 10_000,
      overheadMs: 1_600,
    });
    expect(bound).toBe(57_400);
  });

  it("counts a file with no stored duration as the median of the known ones", () => {
    // Known: 2, 4 and 6 s, median 4 s; the unknown file counts 4 s. One tier of four:
    // wallEstimate(16000, 6000, 4) = 4000 + 4500 = 8500. 2 × (17600 + 2900 + 8500) = 58000.
    const bound = lateBoundMs({
      durations: [2_000, null, 6_000, 4_000],
      tierSize: 4,
      startMs: 17_600,
      overheadMs: 2_900,
    });
    expect(bound).toBe(58_000);
  });

  it("counts unknown durations as 0 when none is known, so start and overhead remain", () => {
    expect(
      lateBoundMs({ durations: [null, null], tierSize: 4, startMs: 500, overheadMs: 250 }),
    ).toBe(1_500);
  });

  it("with no file, is twice the start", () => {
    expect(lateBoundMs({ durations: [], tierSize: 4, startMs: 3_000, overheadMs: 1_000 })).toBe(
      6_000,
    );
  });

  it("uses a factor of 2, a ratio and no time", () => {
    expect(LATE_FACTOR).toBe(2);
  });
});

describe("median", () => {
  it("is 0 for no values, the middle one for odd counts, the mean of the two middle ones else", () => {
    expect(median([])).toBe(0);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
