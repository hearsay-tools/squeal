import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  atomicCompare,
  atomicCompareMarkdown,
  atomicMarkdown,
  atomicTrend,
  fisherTwoSided,
  type Json,
  type ResultsFile,
  resultsName,
  trendLines,
  trendMarkdown,
} from "../../evals/lib/index.mjs";

// 006-48: an atomic run with a variant arm, compared per model, scenario and measure, and left
// out of both tables.
const RESULTS = join(import.meta.dirname, "../../evals/results");
const read = (name: string) => JSON.parse(readFileSync(join(RESULTS, `${name}.json`), "utf8"));

/** Cells of one arm: `met[i]` is `slow-through-squeal`, `claim-true` is always met. */
const armCells = (arm: string, harness: string, model: string, met: (boolean | null)[]) =>
  met.map((m, i) => ({
    id: `a2-slow.${arm}.${harness}-${model}.e-medium.r${i + 1}`,
    task: "a2-slow",
    variant: arm,
    harness,
    model,
    rep: i + 1,
    atomic: { measures: { "slow-through-squeal": m, "claim-true": true } },
  }));
const of = (k: number, n = 10) => Array.from({ length: n }, (_, i) => i < k);

const twoArms = {
  kind: "atomic-variant",
  date: "2026-10-13",
  run: "20261013T120000Z-abcdef",
  squealVersion: "0.1.131",
  commit: "9c762e65aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  conditions: { variant: "p0", tasks: { "a2-slow": { prompt: "6c2684281064", knobs: {} } } },
  variantConditions: {
    variant: "stop-slow",
    tasks: { "a2-slow": { prompt: "6c2684281064", knobs: {} } },
  },
  cells: [
    ...armCells("p0", "claude", "claude-haiku-5-5", of(4)),
    ...armCells("stop-slow", "claude", "claude-haiku-5-5", of(10)),
    ...armCells("p0", "codex", "gpt-6-astra", of(3)),
    ...armCells("stop-slow", "codex", "gpt-6-astra", of(8)),
    // A model that never reached the model counts nowhere; an arm with nothing computable has no p.
    { ...armCells("p0", "codex", "gpt-6-astra", [false])[0], rep: 11, reachedModel: false },
    ...armCells("p0", "claude", "claude-sonnet-5-5", [null, null]),
    ...armCells("stop-slow", "claude", "claude-sonnet-5-5", [true, false]),
  ],
} as Json;

describe("two-sided Fisher (006-48)", () => {
  it("is symmetric and sums every table no more likely than the observed one", () => {
    // 10/10 against 4/10: the tables k = 10 and k = 4 each have C(14,4) / C(20,10).
    expect(fisherTwoSided({ k: 4, n: 10 }, { k: 10, n: 10 })).toBeCloseTo(2002 / 184756, 12);
    expect(fisherTwoSided({ k: 10, n: 10 }, { k: 4, n: 10 })).toBeCloseTo(2002 / 184756, 12);
    // 3/10 against 8/10, R's fisher.test: 0.06978.
    expect(fisherTwoSided({ k: 3, n: 10 }, { k: 8, n: 10 })).toBeCloseTo(0.069779, 5);
    expect(fisherTwoSided({ k: 5, n: 10 }, { k: 5, n: 10 })).toBe(1);
  });
});

describe("an atomic variant run's arms, side by side (006-48)", () => {
  it("compares each model's arms per scenario and measure, the shipped arm first", () => {
    const { arms, rows } = atomicCompare(twoArms);
    expect(arms).toEqual(["p0", "stop-slow"]);
    const row = (model: string, measure: string) =>
      rows.find((r) => r.model === model && r.measure === measure);
    expect(row("claude claude-haiku-5-5", "slow-through-squeal")).toEqual({
      model: "claude claude-haiku-5-5",
      scenario: "a2-slow",
      measure: "slow-through-squeal",
      counts: [
        { k: 4, n: 10 },
        { k: 10, n: 10 },
      ],
      p: expect.closeTo(2002 / 184756, 12),
    });
    expect(row("codex gpt-6-astra", "slow-through-squeal")?.counts).toEqual([
      { k: 3, n: 10 },
      { k: 8, n: 10 },
    ]);
    expect(row("codex gpt-6-astra", "slow-through-squeal")?.p).toBeCloseTo(0.069779, 5);
    expect(row("codex gpt-6-astra", "claim-true")?.p).toBe(1);
    expect(row("claude claude-sonnet-5-5", "slow-through-squeal")).toMatchObject({
      counts: [null, { k: 1, n: 2 }],
      p: null,
    });
    expect(rows.map((r) => `${r.model} ${r.measure}`)).toEqual([
      "claude claude-haiku-5-5 claim-true",
      "claude claude-haiku-5-5 slow-through-squeal",
      "claude claude-sonnet-5-5 claim-true",
      "claude claude-sonnet-5-5 slow-through-squeal",
      "codex gpt-6-astra claim-true",
      "codex gpt-6-astra slow-through-squeal",
    ]);
  });

  it("prints a table per model with each arm's count, its range and p", () => {
    const md = atomicCompareMarkdown(twoArms, "x.stop-slow.atomic-variant.json");
    expect(md).toContain("# Atomic variant run: p0 against stop-slow");
    expect(md).toContain("## codex gpt-6-astra");
    expect(md).toContain("| Scenario | Measure | p0 | stop-slow | p |");
    expect(md).toContain(
      "| a2-slow | `slow-through-squeal` | 4/10 (17–69%) | 10/10 (72–100%) | 0.011 |",
    );
    expect(md).toContain("| a2-slow | `slow-through-squeal` | - | 1/2 (9–91%) | - |");
  });

  it("refuses a file with no two arms", () => {
    expect(() =>
      atomicCompare({ ...(twoArms as object), variantConditions: null } as Json),
    ).toThrow(/no two arms/);
  });
});

describe("ATOMIC.md and TREND.md leave an atomic variant run out (006-48)", () => {
  const name = resultsName({
    date: "2026-10-13",
    version: "0.1.131",
    run: "20261013T120000Z-abcdef",
    variant: "stop-slow",
    atomic: true,
  }).replace(/\.json$/, "");

  it("names it apart from an atomic run, which keeps its name", () => {
    expect(name).toBe("2026-10-13-0.1.131.20261013T120000Z-abcdef.stop-slow.atomic-variant");
    // evals/bin/atomic-trend.mjs reads only `*.atomic.json`.
    expect(`${name}.json`.endsWith(".atomic.json")).toBe(false);
    expect(resultsName({ date: "d", version: "v", run: "r", atomic: true })).toBe(
      "d-v.r.atomic.json",
    );
  });

  it("ATOMIC.md: by its kind, whatever its name", () => {
    const atomic = "2026-10-12-0.1.131.20261012T134945Z-3f2edd.atomic";
    const shipped = { name: atomic, data: read(atomic) };
    const data = read(atomic);
    const variant = {
      name: `${atomic}-variant`,
      data: {
        ...data,
        date: "2026-10-13",
        run: "20261013T120000Z-abcdef",
        squealVersion: "0.1.132",
        kind: "atomic-variant",
        variantConditions: { ...data.conditions, variant: "stop-slow" },
        cells: data.cells.map((c: Record<string, Json>) => ({
          ...c,
          claim: "pass",
          truthPass: false,
        })),
      },
    };
    expect(atomicTrend([shipped, variant]).runs.map((r) => r.name)).toEqual([atomic]);
    expect(atomicMarkdown([shipped, variant])).toBe(atomicMarkdown([shipped]));
  });

  it("TREND.md: by its kind", () => {
    const file = "2026-10-12-0.1.131.20261012T191126Z-af5be4";
    const base = { name: file, data: read(file) as ResultsFile };
    const variant = {
      name,
      data: { ...base.data, date: "2026-10-13", kind: "atomic-variant" } as ResultsFile,
    };
    const names = trendLines([base, variant]).flatMap((l) => l.runs.map((r) => r.name));
    expect(names).toEqual([file]);
    expect(trendMarkdown([base, variant])).toBe(trendMarkdown([base]));
  });
});
