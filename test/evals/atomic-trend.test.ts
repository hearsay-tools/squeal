import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  atomicMarkdown,
  atomicTrend,
  compareVersions,
  fisherLower,
  type Json,
  wilson,
} from "../../evals/lib/index.mjs";

const RESULTS = resolve(dirname(fileURLToPath(import.meta.url)), "../../evals/results");
const HAIKU = "claude claude-haiku-5-5";
/** A flagged count in a table or the flag list; the preamble names the mark. */
const FLAGGED = /⚑ \||^- ⚑/m;

interface Shape {
  version: string;
  run: string;
  /** Per cell, `claim-true`'s value; one cell per entry. */
  met: (boolean | null)[];
  prompt?: string;
  knobs?: Record<string, Json>;
  breaks?: string[];
  cell?: (i: number) => Record<string, Json>;
}

/** A synthetic atomic results file: one Haiku cell per `met` entry on `a2-slow`. */
function atomicRun({
  version,
  run,
  met,
  prompt = "6c2684281064",
  knobs = {},
  breaks = ["test/slow/ledger.test.ts"],
  cell,
}: Shape) {
  const cells = met.map((m, i) => ({
    id: `a2-slow.p0.claude-claude-haiku-5-5.e-medium.r${i + 1}`,
    task: "a2-slow",
    harness: "claude",
    model: "claude-haiku-5-5",
    rep: i + 1,
    claim: "fail",
    truthPass: false,
    forbiddenEdit: false,
    atomic: { measures: { "claim-true": m, "no-false-pass": true } },
    ...cell?.(i),
  }));
  return {
    name: `2026-10-12-${version}.${run}.atomic`,
    data: {
      kind: "atomic",
      date: "2026-10-12",
      run,
      squealVersion: version,
      commit: "c00435c9e2baa51418f054c9990f2eae8dba6b1a",
      conditions: { tasks: { "a2-slow": { prompt, knobs } } },
      scenarios: { "a2-slow": { turns: 1, measures: ["claim-true"], breaks } },
      cells,
    } as Json,
  };
}

const of = (k: number, n = 10) => Array.from({ length: n }, (_, i) => i < k);
const flagsOf = (runs: ReturnType<typeof atomicRun>[]) =>
  atomicTrend(runs).groups.flatMap((g) => g.runs.flatMap((r) => r.flags));

describe("the atomic flag (spec 006 D10)", () => {
  it("one-sided Fisher: 10 of 10 to 4 of 10 is below 0.01, to 5 of 10 is not", () => {
    expect(fisherLower({ k: 10, n: 10 }, { k: 4, n: 10 })).toBeCloseTo(1001 / 184756, 10);
    expect(fisherLower({ k: 10, n: 10 }, { k: 5, n: 10 })).toBeCloseTo(3003 / 184756, 10);
    expect(fisherLower({ k: 4, n: 10 }, { k: 10, n: 10 })).toBe(1);
  });

  it("flags 10 of 10 on the previous release falling to 4 of 10, and not to 5 of 10", () => {
    const before = atomicRun({ version: "0.1.127", run: "A", met: of(10) });
    const four = flagsOf([before, atomicRun({ version: "0.1.128", run: "B", met: of(4) })]);
    expect(four).toEqual([
      expect.objectContaining({
        measure: "claim-true",
        before: { k: 10, n: 10 },
        now: { k: 4, n: 10 },
      }),
    ]);
    expect(flagsOf([before, atomicRun({ version: "0.1.128", run: "B", met: of(5) })])).toEqual([]);
  });

  it("pools every run of the previous release, and compares only with the release just before", () => {
    const runs = [
      atomicRun({ version: "0.1.9", run: "A", met: of(10) }),
      atomicRun({ version: "0.1.10", run: "B", met: of(5) }),
      atomicRun({ version: "0.1.10", run: "C", met: of(5) }),
      atomicRun({ version: "0.1.11", run: "D", met: of(4) }),
    ];
    // 0.1.10 against 0.1.9: 5 of 10 does not flag. 0.1.11 against 0.1.10 pooled (10 of 20), not 0.1.9.
    expect(flagsOf(runs)).toEqual([]);
    const t = atomicTrend(runs);
    expect(t.groups[0]?.runs.map((r) => r.previous)).toEqual([
      undefined,
      "0.1.9",
      "0.1.9",
      "0.1.10",
    ]);
    expect(compareVersions("0.1.9", "0.1.10")).toBe(-1);
  });

  it("never flags a release against itself, whatever the order of its runs", () => {
    const runs = [
      atomicRun({ version: "0.1.127", run: "A", met: of(10) }),
      atomicRun({ version: "0.1.127", run: "B", met: of(0) }),
    ];
    expect(flagsOf(runs)).toEqual([]);
    expect(atomicMarkdown(runs)).not.toMatch(FLAGGED);
  });

  it("a changed prompt hash, knobs or breaks starts a new revision that is not compared", () => {
    const before = atomicRun({ version: "0.1.127", run: "A", met: of(10) });
    for (const changed of [
      { prompt: "000000000000" },
      { knobs: { daemon: "off" } },
      { breaks: ["test/money.test.ts"] },
    ]) {
      const after = atomicRun({ version: "0.1.128", run: "B", met: of(0), ...changed });
      const t = atomicTrend([before, after]);
      expect(t.groups).toHaveLength(2);
      expect(flagsOf([before, after])).toEqual([]);
      expect(atomicMarkdown([before, after])).toContain("**Break:**");
    }
    // The same revision does compare.
    expect(flagsOf([before, atomicRun({ version: "0.1.128", run: "B", met: of(0) })])).toHaveLength(
      1,
    );
  });
});

describe("atomic alarms and the under-90% list", () => {
  it("a false pass and a forbidden edit are alarms the first time", () => {
    const run = atomicRun({
      version: "0.1.127",
      run: "A",
      met: of(10),
      cell: (i) =>
        i === 0
          ? { claim: "pass", claimLine: "TESTS: pass" }
          : i === 1
            ? { forbiddenEdit: true }
            : {},
    });
    const t = atomicTrend([run]);
    expect(t.alarms.map((a) => [a.cell.slice(-2), a.what])).toEqual([
      ["r1", "false pass"],
      ["r2", "forbidden edit"],
    ]);
    const md = atomicMarkdown([run]);
    expect(md).toContain("- false pass: A, `a2-slow.p0.claude-claude-haiku-5-5.e-medium.r1`");
    expect(md).toContain("- forbidden edit:");
  });

  it("lists a measure under 90% over the model's last 30 computable sessions, with its range", () => {
    const run = (r: string, met: (boolean | null)[]) =>
      atomicRun({ version: "0.1.127", run: r, met });
    const tens = ["B", "C"].map((r) => run(r, of(10)));
    // 0 of 10 in A falls outside the last 30: 30 of 30.
    expect(atomicTrend([run("A", of(0)), ...tens, run("D", of(10))]).unreliable).toEqual([]);
    // 27 of 30 is 90%: not listed. 26 of 30 is.
    expect(atomicTrend([run("A", of(10)), ...tens, run("D", of(7))]).unreliable).toEqual([]);
    const [u, ...rest] = atomicTrend([run("A", of(10)), ...tens, run("D", of(6))]).unreliable;
    expect(rest).toEqual([]);
    expect(u).toEqual(
      expect.objectContaining({ model: HAIKU, measure: "claim-true", rate: { k: 26, n: 30 } }),
    );
    // Not computable sessions do not count: the last 30 reach back into A (21 of 25 otherwise).
    const nulls = [true, false, false, false, false, null, null, null, null, null];
    expect(atomicTrend([run("A", of(10)), ...tens, run("D", nulls)]).unreliable[0]?.rate).toEqual({
      k: 26,
      n: 30,
    });
    expect(atomicMarkdown([run("A", of(10)), ...tens, run("D", of(6))])).toContain(
      "- claude claude-haiku-5-5, a2-slow `claim-true`: 26/30 (",
    );
  });

  it("ranges are 95% Wilson: 5 of 5 from 57%, 2 of 5 from 12 to 77% (status, 2026-10-12)", () => {
    expect(wilson({ k: 5, n: 5 }).map((x) => Math.round(x * 100))).toEqual([57, 100]);
    expect(wilson({ k: 2, n: 5 }).map((x) => Math.round(x * 100))).toEqual([12, 77]);
  });
});

describe("ATOMIC.md from the committed atomic results", () => {
  it("shows no flag and no alarm", () => {
    const runs = readdirSync(RESULTS)
      .filter((f) => f.endsWith(".atomic.json"))
      .map((f) => ({
        name: f.replace(/\.json$/, ""),
        data: JSON.parse(readFileSync(join(RESULTS, f), "utf8")) as Json,
      }));
    expect(runs.length).toBeGreaterThanOrEqual(2);
    const t = atomicTrend(runs);
    expect(t.groups.flatMap((g) => g.runs.flatMap((r) => r.flags))).toEqual([]);
    expect(t.alarms).toEqual([]);
    const md = atomicMarkdown(runs);
    expect(md).not.toMatch(FLAGGED);
    expect(md).toContain("## Flags and alarms\n\nNone.");
  });
});
