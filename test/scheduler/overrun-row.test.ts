import { describe, expect, it } from "vitest";
import {
  OVERRUN_FLOOR_MS,
  overrunAfterMs,
  tierEstimateMs,
} from "../../src/core/scheduler/overrun.js";
import type { Tier } from "../../src/core/scheduler/tiers.js";
import { NO_YIELD_ROW, readYieldRow, yieldRowText } from "../../src/core/scheduler/yield-row.js";
import type { EpochMs } from "../../src/core/types/common.js";
import type { TierOverrun } from "../../src/core/types/standing.js";

/*
 * Row 011-399 (gh-233): the threshold a file of a tier overruns at, and the
 * `yields` row's additive `overruns` key, which an older reader leaves alone.
 */

const tierOf = (durations: readonly (number | null)[]) =>
  ({ files: durations.map((durationMs) => ({ file: { durationMs } })) }) as unknown as Tier;

describe("when a file of a tier overruns (row 011-399)", () => {
  it("10 times its own time, at least 60 s; with none known, 60 s past the tier's estimate", () => {
    const tier = tierOf([200, 30_000, null]);
    expect(tierEstimateMs(tier)).toBe(30_000);
    expect(overrunAfterMs(tier, 200)).toBe(OVERRUN_FLOOR_MS);
    expect(overrunAfterMs(tier, 30_000)).toBe(300_000);
    expect(overrunAfterMs(tier, null)).toBe(30_000 + OVERRUN_FLOOR_MS);
    expect(overrunAfterMs(tierOf([null]), null)).toBe(OVERRUN_FLOOR_MS);
  });
});

describe("the yields row's overruns (row 011-399)", () => {
  const overrun: TierOverrun = {
    at: 1_000 as EpochMs,
    deadline: 601_000 as EpochMs,
    files: [{ project: "", path: "test/h.test.ts", usualMs: 200 }],
  };

  it("round-trips, and alone keeps the row", () => {
    const empty = { ...NO_YIELD_ROW, overruns: new Map([["r1", overrun]]) };
    const text = yieldRowText(5 as EpochMs, empty);
    expect(text).not.toBeNull();
    expect(readYieldRow(text, 0 as EpochMs).overruns).toEqual(new Map([["r1", overrun]]));
    expect(yieldRowText(5 as EpochMs, { ...NO_YIELD_ROW, overruns: new Map() })).toBeNull();
  });

  it("an entry that does not read is dropped; a row without the key has none", () => {
    const bad = { at: 5, tiers: {}, overruns: { r1: { at: "x", deadline: null, files: [] } } };
    expect(readYieldRow(JSON.stringify(bad), 0 as EpochMs).overruns).toEqual(new Map());
    const old = { at: 5, tiers: {}, last: null };
    expect(readYieldRow(JSON.stringify(old), 0 as EpochMs).overruns).toEqual(new Map());
  });
});
