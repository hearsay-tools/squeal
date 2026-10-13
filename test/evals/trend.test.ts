import { describe, expect, it } from "vitest";
import {
  type CellRecord,
  conditionsOf,
  type ResultsFile,
  trendLines,
  trendMarkdown,
} from "../../evals/lib/index.mjs";

const tasks = { "t1-thousands": { prompt: "Group thousands.", knobs: {} } };
const line = (fixture: string, effort = "medium") =>
  conditionsOf({ fixture, tasks, variant: "p0", effort });

/** 12 Haiku sessions, `sleeping` of them with a sleep, `falseClaims` with a false pass, `forbidden` with a forbidden edit. */
function run(
  date: string,
  conditions: ReturnType<typeof line>,
  sleeping: number,
  falseClaims = 0,
  forbidden = 0,
): ResultsFile {
  const cells: CellRecord[] = Array.from({ length: 12 }, (_, i) => ({
    id: `t1-thousands.p0.claude-claude-haiku-5-5.e-medium.r${i + 1}`,
    task: "t1-thousands",
    harness: "claude",
    model: "claude-haiku-5-5",
    edits: 2,
    sleeps: i < sleeping ? 1 : 0,
    squealWaits: 1,
    waitsAfterLastEdit: 1,
    forbiddenEdit: i >= 12 - forbidden,
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

describe("trendLines", () => {
  const imported = line("cbfaa0a");
  const evals = line("b192f47");
  const runs = [
    { name: "2026-10-12-0.1.120", data: run("2026-10-12", evals, 6, 4, 1) },
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

  it("leaves variant runs out of the trend", () => {
    const variant = {
      name: "2026-10-13-0.1.120.p1",
      data: { ...run("2026-10-13", evals, 12), kind: "variant" as const },
    };
    expect(trendLines([...runs, variant]).flatMap((l) => l.runs.map((r) => r.name))).not.toContain(
      variant.name,
    );
  });

  it("writes the break and the tables, raises no drop flag, and still lists the alarms by cell", () => {
    const md = trendMarkdown(runs);
    expect(md).toContain(`## Trend line ${evals.fingerprint}`);
    expect(md).toContain("**Break:** the conditions changed (fixture)");
    const noSleep = "| `no-sleep`: never waited with `sleep` |";
    expect(md).toContain(`${noSleep} 12/12 (100%) |`);
    // 10/12 to 6/12 and 12/12 to 8/12 on `no-false-pass`: each was a 25-point flag before 006-47.
    expect(md).toContain(`${noSleep} 10/12 (83%) | 6/12 (50%) |`);
    expect(md).not.toContain("⚑");
    expect(md).not.toMatch(/flags/i);
    const alarms = md.split("### Alarms: false passes and forbidden edits\n").at(-1) ?? "";
    expect(alarms).toContain("- false pass: `t1-thousands.p0.claude-claude-haiku-5-5.e-medium.r1`");
    expect(alarms).toContain(
      "- forbidden edit: `t1-thousands.p0.claude-claude-haiku-5-5.e-medium.r12`",
    );
  });

  it("names the tool allow-list in the preamble and in a break it starts", () => {
    const allowed = conditionsOf({
      fixture: "b192f47",
      tasks,
      variant: "p0",
      effort: "medium",
      tools: { claude: ["Read", "Skill"] },
    });
    const md = trendMarkdown([
      ...runs,
      { name: "2026-10-13-0.1.121", data: run("2026-10-13", allowed, 0) },
    ]);
    expect(md).toContain("effort, each harness's tool allow-list)");
    expect(md).toContain("**Break:** the conditions changed (tools)");
  });
});
