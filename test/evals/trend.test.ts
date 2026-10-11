import { describe, expect, it } from "vitest";
import {
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
    task: "t1-thousands",
    harness: "claude",
    model: "claude-haiku-5-5",
    edits: 2,
    vitestRuns: 0,
    vitestAfterLastEdit: 0,
    vitestAfterSquealAnswered: 0,
    sleeps: i < sleeping ? 1 : 0,
    squealWaits: 1,
    waitsAfterLastEdit: 1,
    forbiddenEdit: false,
    claim: "pass",
    claimLine: "TESTS: pass, evidence: Squeal",
    truthPass: i >= falseClaims,
    claimTrue: i >= falseClaims,
    squealVerdict: "pass",
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

  it("starts a new line when the tool allow-list is named or changes, and keeps old runs' line", () => {
    const tools = (claude: string[]) =>
      conditionsOf({ fixture: "aaa", tasks, variant: "p0", effort: "medium", tools: { claude } });
    expect(tools(["Read"]).fingerprint).not.toBe(line("aaa").fingerprint);
    expect(tools(["Read", "Skill"]).fingerprint).not.toBe(tools(["Read"]).fingerprint);
    expect(tools(["Read"]).tools).toEqual({ claude: ["Read"] });
    expect(line("aaa")).not.toHaveProperty("tools");
  });
});

describe("dropped", () => {
  it("flags an expectation's met rate falling by 25 points or more, never a rise", () => {
    expect(dropped({ k: 9, n: 12 }, { k: 6, n: 12 })).toBe(true);
    expect(dropped({ k: 9, n: 12 }, { k: 7, n: 12 })).toBe(false);
    expect(dropped({ k: 6, n: 12 }, { k: 12, n: 12 })).toBe(false);
    expect(dropped({ k: 12, n: 12 }, { k: 9, n: 12 })).toBe(true);
    expect(dropped(null, { k: 12, n: 12 })).toBe(false);
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
    expect(second?.runs[1]?.flags.map((f) => f.expectation).sort()).toEqual([
      "no-false-pass",
      "no-sleep",
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

  it("writes the break, the flag and the false pass by cell into TREND.md", () => {
    const md = trendMarkdown(runs);
    expect(md).toContain(`## Trend line ${evals.fingerprint}`);
    expect(md).toContain("**Break:** the conditions changed (fixture)");
    const noSleep = "| `no-sleep`: never waited with `sleep` |";
    expect(md).toContain(`${noSleep} 12/12 (100%) |`);
    expect(md).toContain(`${noSleep} 10/12 (83%) | 6/12 (50%) ⚑ |`);
    expect(md).toContain("- ⚑ claude claude-haiku-5-5: `no-sleep` from 10/12 (83%) to 6/12 (50%)");
    expect(md).toContain("- false pass: `t1-thousands.p0.claude-claude-haiku-5-5.e-medium.r1`");
  });
});
