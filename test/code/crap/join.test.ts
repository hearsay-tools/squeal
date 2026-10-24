import { describe, expect, it } from "vitest";
import type { CoverageSource } from "../../../src/core/code/coverage/index.js";
import { countFile } from "../../../src/core/code/count/index.js";
import { joinCoverage } from "../../../src/core/code/crap/join.js";
import { crapScore } from "../../../src/core/code/crap/score.js";
import { SOURCE, TESTED } from "./fixture.js";

/*
 * Spec 015 D9 (row 015-12): the join by position and the CRAP formula. The
 * record is one Squeal's provider made on Node 24 for `SOURCE` run by a
 * test that calls `add`, `branchy(20)`, `twice([])` and `increment`.
 */

async function joined(sources: readonly CoverageSource[]) {
  const count = await countFile(SOURCE, "typescript");
  const out = joinCoverage(count.functions, sources);
  return Object.fromEntries(count.functions.map((f, i) => [f.qualifiedName, out[i]]));
}

describe("joinCoverage", () => {
  it("joins each function by position, an arrow by its end, and reads V8's call over a shared line", async () => {
    const by = await joined([TESTED]);
    const ran = Object.entries(by).flatMap(([name, j]) => (j?.ran === true ? [name] : []));
    expect(ran).toEqual(["add", "twice", "branchy", "Counter.increment"]);
    // `twice([])` never calls its callback, though its line ran.
    expect(by["twice.<map>"]).toMatchObject({ ran: false, coverage: 0 });
    // `branchy(20)` returned at its first `if`: lines 7, 8 and 9 of 7, 8, 9, 11 and 14; the
    // nested `inner`'s line 12 is not its own.
    expect(by.branchy).toMatchObject({ lines: 5, covered: 3, coverage: 0.6, runBy: [0] });
    expect(by["branchy.inner"]).toMatchObject({ ran: false, coverage: 0, runBy: [] });
    expect(by.add).toMatchObject({ lines: 2, covered: 2, coverage: 1 });
    expect(by.arrow).toMatchObject({ ran: false });
  });

  it("unions the loaders: a function ran when any of them ran it, and their lines add up", async () => {
    // A second test file that calls `branchy(5)` and `inner` through `branchy(0)`.
    const second: CoverageSource = {
      ...TESTED,
      covered: Buffer.from([0b1100_0000, 0b0010_1100]).toString("base64"),
      functions: TESTED.functions.map((f) =>
        f[0] === 7 || f[0] === 11 ? [f[0], f[1], f[2], f[3], 1] : [f[0], f[1], f[2], f[3], 0],
      ),
    };
    const by = await joined([TESTED, second]);
    expect(by.branchy).toMatchObject({ lines: 5, covered: 5, coverage: 1, runBy: [0, 1] });
    expect(by["branchy.inner"]).toMatchObject({ ran: true, runBy: [1] });
    expect(by.add?.runBy).toEqual([0]);
  });

  it("reads a function no record has a V8 function for by its own lines", async () => {
    const lazy: CoverageSource = { ...TESTED, functions: [] };
    const by = await joined([lazy]);
    // `add`'s body line 2 ran; `never`'s body line 36 did not.
    expect(by.add).toMatchObject({ ran: true });
    expect(by.never).toMatchObject({ ran: false, coverage: 0 });
  });

  it("has nothing ran with no loader", async () => {
    const by = await joined([]);
    expect(Object.values(by).every((j) => j?.ran === false && j.lines === 0)).toBe(true);
  });
});

describe("crapScore", () => {
  it("is CC² × (1 − cov)³ + CC", () => {
    expect(crapScore(10, 0)).toBe(110);
    expect(crapScore(10, 0.5)).toBe(22.5);
    expect(crapScore(5, 0.6)).toBeCloseTo(6.6, 10);
    // Savoia's table: CC 10 needs 42% to stay at or under 30, and from CC 31 nothing does.
    expect(crapScore(10, 0.42)).toBeLessThanOrEqual(30);
    expect(crapScore(10, 0.41)).toBeGreaterThan(30);
    expect(crapScore(31, 0.94)).toBeGreaterThan(30);
  });

  it("is CC from 95% on, as PHPUnit's", () => {
    expect(crapScore(40, 0.95)).toBe(40);
    expect(crapScore(40, 1)).toBe(40);
    expect(crapScore(3, 0.949)).toBeGreaterThan(3);
  });
});
