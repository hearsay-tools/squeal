import { afterEach, describe, expect, test, vi } from "vitest";
import { count, thousands } from "../../src/core/ps/render-units.js";

/*
 * Spec 014 goal 6 (task 014-23): a count prints with a comma every three
 * digits, as `en-US` writes it, without `Intl`, whose first call costs about
 * 19 ms of a 0.3 s budget (`lessons.md` Goal 6).
 */

afterEach(() => {
  vi.restoreAllMocks();
});

const COUNTS = [0, 1, 7, 12, 999, 1_000, 1_234, 3_856, 99_999, 100_000, 1_234_567, -1, -1_234];

describe("thousands", () => {
  test("prints each count as en-US does", () => {
    for (const n of [...COUNTS, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER])
      expect(thousands(n), String(n)).toBe(n.toLocaleString("en-US"));
  });

  test("calls no Intl formatter", () => {
    const local = vi.spyOn(Number.prototype, "toLocaleString");
    const format = vi.spyOn(Intl, "NumberFormat");
    expect(COUNTS.map((n) => thousands(n))).toHaveLength(COUNTS.length);
    expect(count(1_652, "lock file")).toBe("1,652 lock files");
    expect(local).not.toHaveBeenCalled();
    expect(format).not.toHaveBeenCalled();
  });
});
