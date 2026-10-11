import { describe, expect, it } from "vitest";
import {
  BEHAVIOURS,
  type CellRecord,
  conditionsOf,
  dropped,
  type ResultsFile,
  trendLines,
  trendMarkdown,
} from "../../evals/lib/index.mjs";

const tasks = { "t1-thousands": { prompt: "Group thousands.", knobs: {} } };
const line = (fixture: string, effort = "medium") =>
  conditionsOf({ fixture, tasks, variant: "p0", effort });

/** `n` Haiku sessions, `sleeping` of them with a sleep, `falseClaims` with a false pass. */
function run(
  date: string,
  conditions: ReturnType<typeof line>,
  sleeping: number,
  falseClaims = 0,
): ResultsFile {
  const cells: CellRecord[] = Array.from({ length: 12 }, (_, i) => ({
    id: `t1-thousands.p0.claude-claude-haiku-5-5.e-medium.r${i + 1}`,
    harness: "claude",
    model: "claude-haiku-5-5",
    vitestRuns: 0,
    sleeps: i < sleeping ? 1 : 0,
    waitsAfterLastEdit: 1,
    forbiddenEdit: false,
    claim: "pass",
    claimLine: "TESTS: pass, evidence: Squeal",
    truthPass: i >= falseClaims,
    claimTrue: i >= falseClaims,
    loadStart: 3,
  }));
  return {
    kind: "baseline",
    date,
    squealVersion: "0.1.120",
    commit: "abc12345",
    conditions,
    cells,
  };
}

describe("conditionsOf", () => {
  it("fingerprints the fixture, prompts, knobs, variant and effort, not the versions", () => {
    expect(line("aaa").fingerprint).toBe(line("aaa").fingerprint);
    expect(line("bbb").fingerprint).not.toBe(line("aaa").fingerprint);
    expect(line("aaa", "high").fingerprint).not.toBe(line("aaa").fingerprint);
    const knob = conditionsOf({
      fixture: "aaa",
      tasks: { "t1-thousands": { prompt: "Group thousands.", knobs: { daemon: "stopped" } } },
      variant: "p0",
      effort: "medium",
    });
    expect(knob.fingerprint).not.toBe(line("aaa").fingerprint);
    expect(line("aaa").tasks["t1-thousands"]?.prompt).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("dropped", () => {
  const sleep = BEHAVIOURS.find((b) => b.key === "sleep");
  const claimTrue = BEHAVIOURS.find((b) => b.key === "claimTrue");
  const skill = BEHAVIOURS.find((b) => b.key === "skill");
  it("flags a change of 25 points or more in the worse direction only", () => {
    if (!sleep || !claimTrue || !skill) throw new Error("behaviour missing");
    expect(dropped(sleep, { k: 3, n: 12 }, { k: 6, n: 12 })).toBe(true);
    expect(dropped(sleep, { k: 3, n: 12 }, { k: 5, n: 12 })).toBe(false);
    expect(dropped(sleep, { k: 6, n: 12 }, { k: 0, n: 12 })).toBe(false);
    expect(dropped(claimTrue, { k: 12, n: 12 }, { k: 9, n: 12 })).toBe(true);
    expect(dropped(skill, { k: 12, n: 12 }, { k: 0, n: 12 })).toBe(false);
    expect(dropped(sleep, null, { k: 12, n: 12 })).toBe(false);
  });
});

describe("trendLines", () => {
  const imported = line("cbfaa0a");
  const evals = line("b192f47");
  const runs = [
    { name: "2026-10-12-0.1.120", data: run("2026-10-12", evals, 6, 4) },
    { name: "2026-10-10-0.1.101", data: run("2026-10-10", imported, 0) },
    { name: "2026-10-11-0.1.110", data: run("2026-10-11", evals, 2) },
  ];

  it("groups runs into lines by fingerprint, oldest first", () => {
    const lines = trendLines(runs);
    expect(lines.map((l) => [l.fingerprint, l.runs.map((r) => r.name)])).toEqual([
      [imported.fingerprint, ["2026-10-10-0.1.101"]],
      [evals.fingerprint, ["2026-10-11-0.1.110", "2026-10-12-0.1.120"]],
    ]);
  });

  it("never flags across lines, and flags a drop against the previous run of the same line", () => {
    const [first, second] = trendLines(runs);
    expect(first?.runs[0]?.flags).toEqual([]);
    expect(second?.runs[0]?.flags).toEqual([]); // 2/12 sleeping against 0/12 in another line: no flag
    expect(second?.runs[1]?.flags.map((f) => f.behaviour).sort()).toEqual([
      "claimFalse",
      "claimTrue",
      "sleep",
    ]);
  });

  it("leaves variant runs out of the trend", () => {
    const variant = {
      name: "2026-10-13-0.1.120.p1",
      data: { ...run("2026-10-13", evals, 12), kind: "variant" as const },
    };
    expect(trendLines([...runs, variant]).flatMap((l) => l.runs.map((r) => r.name))).not.toContain(
      variant.name,
    );
  });

  it("writes the break, the flag and the false claim by cell into TREND.md", () => {
    const md = trendMarkdown(runs);
    expect(md).toContain(`## Trend line ${evals.fingerprint}`);
    expect(md).toContain("**Break:** the conditions changed (fixture)");
    expect(md).toContain("| `sleep` | lower | 0/12 (0%) |");
    expect(md).toContain("| `sleep` | lower | 2/12 (17%) | 6/12 (50%) ⚑ |");
    expect(md).toContain("- ⚑ claude claude-haiku-5-5: `sleep` from 2/12 (17%) to 6/12 (50%)");
    expect(md).toContain("- false claim: `t1-thousands.p0.claude-claude-haiku-5-5.e-medium.r1`");
  });
});
