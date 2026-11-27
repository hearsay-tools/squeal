// Row 025-27: the comparison names a change only above its run-to-run spread, hooks show p50
// beside p95, and each cell records and prints the machine speed around it. Input: the real
// three-run results of row 025-26 (research/probes/hook-slowdown/bench/).
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

type Spread = { n: number; mean: number; min: number; max: number };
type Reading = { sha256: number; jiffies: { steal: number; total: number } };
type Machine = { sha256Before: number; sha256After: number; stealPct: number | null };
interface Compare {
  spread(xs: (number | null)[]): Spread | null;
  isNoise(a: Spread | null, b: Spread | null): boolean;
}
interface MachineMod {
  stealJiffies(text: string): { steal: number; total: number };
  stealPct(a: { steal: number; total: number }, b: { steal: number; total: number }): number | null;
  machineText(m: Machine | undefined): string | null;
}
interface RunAll {
  defaultRepeat(versions: number): number;
  recordMachine(cellDir: string, before: Reading, after: Reading): Machine;
}
interface Summarize {
  summarize(dir: string): { scorecard: string; values: Record<string, Record<string, unknown>> };
}

const BENCH = join(import.meta.dirname, "../../bench");
const PROBES = join(
  import.meta.dirname,
  "../../docs/specifications/025-performance/research/probes/hook-slowdown/bench",
);
// A variable path: TypeScript types these plain-JavaScript modules as `any`, cast to the shapes above.
const load = (name: string) => import(join(BENCH, name));
const cmp: Compare = await load("compare.mjs");
const machine: MachineMod = await load("machine.mjs");
const runAll: RunAll = await load("run-all.mjs");
const sum: Summarize = await load("summarize.mjs");

const tmp = mkdtempSync(join(tmpdir(), "bench-compare-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A stored run copied to tmp (summarize writes scores.json beside it). */
function stored(name: string, as = name): string {
  const dir = join(tmp, as);
  cpSync(join(PROBES, name), dir, { recursive: true });
  return dir;
}
const row = (card: string, metric: string) =>
  card.split("\n").find((l) => l.startsWith(`| ${metric} |`) || l.includes(`| ${metric} |`));

describe("noise against the run-to-run spread", () => {
  it("is noise only when both sides ran twice or more and their ranges overlap", () => {
    const a = cmp.spread([190, 244, 254]);
    expect(a).toEqual({ n: 3, mean: 229.33333333333334, min: 190, max: 254 });
    expect(cmp.isNoise(a, cmp.spread([167, 173, 222]))).toBe(true);
    expect(cmp.isNoise(a, cmp.spread([75, 80, 94]))).toBe(false);
    expect(cmp.isNoise(cmp.spread([190]), cmp.spread([167]))).toBe(false);
    expect(cmp.spread([null, Number.POSITIVE_INFINITY])).toBeNull();
  });

  it("marks the 0.1.640 vs 0.1.645 wt-3 changes as noise, with each range", () => {
    const card = sum.summarize(stored("wt3")).scorecard;
    // 0.1.640 runs 254, 244, 190 ms; 0.1.645 runs 173, 222, 167 ms: an 18% drop inside the spread.
    expect(row(card, "Hook after each batch of tool calls (slowest 5%)")).toBe(
      "| wt-3 | Hook after each batch of tool calls (slowest 5%) | 229 ms (190–254) | 187 ms (167–222) | -18% noise |",
    );
    expect(row(card, "Hook write wait for the daemon main thread (longest)")).toContain(
      "| -71% noise |",
    );
    expect(card).toContain("| wt-3 | 0.1.645 | 3 | ✅ | 81 (79–82) | +3 noise |");
    // One value in every run shows no range.
    expect(row(card, "Hook writes that waited over 250 ms for the daemon main thread")).toContain(
      "| 0 | 0 |",
    );
  });

  it("leaves a change outside the spread unmarked (0.1.645 in the ref bisect)", () => {
    const card = sum.summarize(stored("bisect-ref")).scorecard;
    const p95 = row(card, "Hook after each batch of tool calls (slowest 5%)") ?? "";
    // Columns: five versions, then Δ% for 0.1.641, 0.1.644, 0.1.645, 0.1.653.
    const deltas = p95
      .split("|")
      .slice(8, 12)
      .map((x) => x.trim());
    expect(deltas).toEqual(["-13% noise", "-5% noise", "-29%", "-2% noise"]);
    expect(card).toContain("| Δ% 0.1.641 | Δ% 0.1.644 | Δ% 0.1.645 | Δ% 0.1.653 |");
  });

  it("shows each hook's p50 beside its p95", () => {
    const dir = stored("wt3", "wt3-p50");
    const r = sum.summarize(dir);
    const lines = r.scorecard.split("\n");
    const at = (m: string) => lines.findIndex((l) => l.startsWith(`| wt-3 | ${m} |`));
    const pre50 = at("Hook before each tool call (median)");
    const post50 = at("Hook after each batch of tool calls (median)");
    expect(pre50).toBeGreaterThan(0);
    expect(at("Hook before each tool call (slowest 5%)")).toBe(pre50 + 1);
    expect(at("Hook after each batch of tool calls (slowest 5%)")).toBe(post50 + 1);
    const v = r.values["wt-3@0.1.640-r1"] ?? {};
    expect(v["hook.preToolUse.p50"]).toBeLessThan(v["hook.preToolUse.p95"] as number);
    expect(r.scorecard).toContain("`hook.postToolBatch.p50`");
  });
});

describe("machine speed per cell", () => {
  it("reads steal from /proc/stat's cpu line and turns two readings into a percent", () => {
    const a = machine.stealJiffies("cpu  100 0 50 800 10 0 0 40 0 0\ncpu0 1 2 3");
    expect(a).toEqual({ steal: 40, total: 1000 });
    const b = machine.stealJiffies("cpu  300 0 100 1500 20 0 0 80 30 0\n");
    expect(machine.stealPct(a, b)).toBeCloseTo((100 * 40) / 1000);
    expect(machine.stealPct(a, a)).toBeNull();
  });

  it("records it in cell.json and prints it in the scorecard", () => {
    const dir = stored("wt3", "wt3-machine");
    const cell = join(dir, "cells", "wt-3@0.1.645-r2");
    const rec = runAll.recordMachine(
      cell,
      { sha256: 1931, jiffies: { steal: 10, total: 10_000 } },
      { sha256: 1902.4, jiffies: { steal: 50, total: 20_000 } },
    );
    expect(rec).toEqual({ sha256Before: 1931, sha256After: 1902.4, stealPct: 0.4 });
    const json = JSON.parse(readFileSync(join(cell, "cell.json"), "utf8")) as {
      machine: Machine;
      phases: unknown;
    };
    expect(json.machine).toEqual(rec);
    expect(json.phases).toBeDefined();
    const card = sum.summarize(dir).scorecard;
    expect(card).toContain("## Machine speed per cell");
    expect(card).toContain("- wt-3@0.1.645-r2: SHA-256 1931→1902 MiB/s, steal 0.4%");
    expect(card).toContain("- wt-3@0.1.640-r1: not recorded");
  });

  it("says when a stored run recorded none", () => {
    const card = sum.summarize(stored("wt3", "wt3-old")).scorecard;
    expect(card).toContain("No cell recorded its machine speed");
  });

  it("does not create a cell.json for a cell that wrote none", () => {
    const dir = join(tmp, "no-cell");
    const r = { sha256: 1, jiffies: { steal: 0, total: 0 } };
    expect(runAll.recordMachine(dir, r, r).stealPct).toBeNull();
    expect(() => readFileSync(join(dir, "cell.json"))).toThrow();
  });
});

describe("paired runs repeat by default", () => {
  it("runs a paired comparison 3 times and one version once", () => {
    expect(runAll.defaultRepeat(2)).toBe(3);
    expect(runAll.defaultRepeat(5)).toBe(3);
    expect(runAll.defaultRepeat(1)).toBe(1);
  });

  it("boat-run passes --repeat only when given", () => {
    const sh = readFileSync(join(BENCH, "boat-run.sh"), "utf8");
    expect(sh).toContain('REPEAT=""');
    expect(sh).toContain(["$", "{REPEAT:+ --repeat $REPEAT}"].join(""));
  });
});
