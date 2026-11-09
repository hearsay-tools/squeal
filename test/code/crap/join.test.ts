import { describe, expect, it } from "vitest";
import { countFile } from "../../../src/core/code/count/index.js";
import type { CoverageSource } from "../../../src/core/code/coverage/types.js";
import { joinCoverage } from "../../../src/core/code/crap/join.js";
import { joinedEntries } from "../../../src/core/code/crap/match.js";
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
    // Review 0.1.297 B4: `twice` has no line of its own inside its body, and line 5 runs
    // outside it, so the record cannot tell.
    expect(by.twice).toMatchObject({ ran: null, coverage: 0, runBy: [] });
  });

  it("has nothing ran with no loader", async () => {
    const by = await joined([]);
    expect(Object.values(by).every((j) => j?.ran === false && j.lines === 0)).toBe(true);
  });
});

/*
 * Spec 020 D4 (row 020-04): the three arrow shapes the join missed. The
 * source and its V8 functions are the ones `cases.mts` recorded (015
 * research `quality-gate.md` Q5, `probes/quality-gate/cases.out.json`); the
 * line bitsets are built here: every line with code, 1 and 3 to 9, ran.
 */
const SHAPES = [
  `import { dep } from "./dep";`,
  `export interface Box { field: number }`,
  `export const pick = (x: unknown) => (x as Box).field;`,
  `export const chain = (a: number) => (xs: number[]) => xs.map((v) => v * a).filter((v) => v > 2).join(",");`,
  `export const three = (a: number) =>`,
  `  (b: number) =>`,
  `    (c: number) => a + b + c;`,
  `export const viaDep = () => dep() + 1;`,
  `export const never = (x: number) => (x > 0 ? x : -x);`,
  ``,
].join("\n");
type Entry = CoverageSource["functions"][number];
const V8_SHAPES: readonly Entry[] = [
  [3, 13, 3, 47, 1],
  [4, 13, 4, 104, 1],
  [4, 22, 4, 104, 1],
  [4, 57, 4, 72, 1],
  [4, 75, 4, 93, 1],
  [5, 13, 7, 27, 1],
  [5, 22, 7, 27, 1],
  [6, 3, 7, 27, 1],
  [8, 13, 8, 36, 1],
  [9, 13, 9, 50, 0],
];
const bitset = (lines: readonly number[]) => {
  const bytes = new Uint8Array(2);
  for (const line of lines) {
    const at = (line - 1) >> 3;
    bytes[at] = (bytes[at] ?? 0) | (1 << ((line - 1) & 7));
  }
  return Buffer.from(bytes).toString("base64");
};
const RAN = [1, 3, 4, 5, 6, 7, 8, 9];

/** The record with `hits` over `V8_SHAPES`' by their start. */
function shapes(hits: Readonly<Record<string, 0 | 1>> = {}): CoverageSource {
  return {
    path: "src/shapes.ts" as CoverageSource["path"],
    blob: "4b27c06ace5fb6d9064281e5d3a7ec5c8d2cc59f" as CoverageSource["blob"],
    lines: bitset(RAN),
    covered: bitset(RAN),
    functions: V8_SHAPES.map(([a, b, c, d, hit]) => [a, b, c, d, hits[`${a}:${b}`] ?? hit]),
  };
}

async function joinedShapes(source: CoverageSource) {
  const count = await countFile(SHAPES, "typescript");
  const entries = joinedEntries(count.functions, source.functions);
  const out = joinCoverage(count.functions, [source]);
  return Object.fromEntries(
    count.functions.map((f, i) => [
      `${f.qualifiedName}:${f.range.startLine}`,
      {
        entry: entries[i]?.slice(0, 2).join(":") ?? null,
        ran: out[i]?.ran,
        coverage: out[i]?.coverage,
      },
    ]),
  );
}

describe("joinCoverage of the arrow shapes the end alone missed (spec 020 D4)", () => {
  it("joins every function of the probe's record to its own V8 function", async () => {
    const by = await joinedShapes(shapes());
    expect(Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.entry]))).toEqual({
      "pick:3": "3:13",
      "chain:4": "4:13",
      "chain.<anonymous>:4": "4:22",
      "chain.<anonymous>.<map>:4": "4:57",
      "chain.<anonymous>.<filter>:4": "4:75",
      "three:5": "5:13",
      "three.<anonymous>:6": "5:22",
      "three.<anonymous>.<anonymous>:7": "6:3",
      "viaDep:8": "8:13",
      "never:9": "9:13",
    });
    expect(Object.values(by).map((v) => v.ran)).toEqual([...Array(9).fill(true), false]);
    expect(by["pick:3"]).toMatchObject({ coverage: 1 });
  });

  it("reads `x => (expr as T).field` by its own V8 function, its end cut at `field`", async () => {
    expect((await joinedShapes(shapes({ "3:13": 0 })))["pick:3"]).toMatchObject({ ran: false });
  });

  it("tells a curried chain's outer arrow from the inner one that ends with it", async () => {
    const by = await joinedShapes(shapes({ "4:22": 0, "4:57": 0, "4:75": 0 }));
    expect(by["chain:4"]).toMatchObject({ ran: true, coverage: 1 });
    expect(by["chain.<anonymous>:4"]).toMatchObject({ ran: false, coverage: 0 });
  });

  it("tells apart three arrow stages that end at one column", async () => {
    const by = await joinedShapes(shapes({ "6:3": 0 }));
    expect(by["three:5"]).toMatchObject({ ran: true });
    expect(by["three.<anonymous>:6"]).toMatchObject({ ran: true });
    expect(by["three.<anonymous>.<anonymous>:7"]).toMatchObject({ ran: false, coverage: 0 });
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
