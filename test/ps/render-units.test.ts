import { afterEach, describe, expect, test, vi } from "vitest";
import {
  age,
  bytes,
  columnDuration,
  count,
  cpuTime,
  dateOf,
  percent,
  sentenceDuration,
  share,
  thousands,
} from "../../src/core/ps/render-units.js";

/* Spec 014 D7 and D8: the words of `squeal ps`, in its text and in its flags' reasons and commands. */

afterEach(() => {
  vi.restoreAllMocks();
});

/*
 * Spec 014 goal 6 (task 014-23): a count prints with a comma every three
 * digits, as `en-US` writes it, without `Intl`, whose first call costs about
 * 19 ms of CPU (`lessons.md` Goal 6).
 */
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

describe("the units", () => {
  test("sizes, ages, CPU times and percents", () => {
    expect([bytes(512 * 1024, true), bytes(0, true), bytes(3 * 2 ** 30), bytes(null)]).toEqual([
      "512K",
      "0",
      "3.0 GiB",
      "unknown",
    ]);
    expect([
      age(null, 0),
      cpuTime(29_000),
      cpuTime(2 * 3_600_000 + 5 * 60_000),
      cpuTime(null),
    ]).toEqual(["?", "0m29s", "2h05m", "?"]);
    expect([share(45.57), share(0.64), percent(null), thousands(3_530)]).toEqual([
      "46%",
      "0.6%",
      "?",
      "3,530",
    ]);
  });

  test("a duration in a column is its largest unit; in a sentence, a flag's reason, it keeps the minutes", () => {
    const ms = [59_999, 99 * 60_000, 100 * 60_000, 11_100_000, 50 * 3_600_000];
    expect(ms.map(columnDuration)).toEqual(["59s", "99m", "1h", "3h", "2d"]);
    expect(ms.map(sentenceDuration)).toEqual(["59 s", "99m", "100m", "3h 05m", "50h 00m"]);
    expect([119_999, 120_000, 7_199_000, 7_200_000].map(sentenceDuration)).toEqual([
      "119 s",
      "2m",
      "119m",
      "2h 00m",
    ]);
  });

  test("a date is a UTC minute", () => {
    expect(dateOf(Date.UTC(2026, 9, 16, 20, 36, 59))).toBe("2026-10-16 20:36 UTC");
  });
});
