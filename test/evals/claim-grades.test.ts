import { describe, expect, it } from "vitest";
import {
  type CellRecord,
  CONTEXT,
  codexTimeline,
  conditionsOf,
  declarations,
  expectationsOf,
  gradeCell,
  metRate,
  rate,
  trendMarkdown,
} from "../../evals/lib/index.mjs";
import { settled } from "./status-snapshot.js";

// 006-12 item 1: a false claim is one of two things. A false pass, `pass` while ground truth
// fails, is the dangerous one: work reported done that is broken. A false fail, `fail` while
// ground truth passes, is what T2's knob flake produces: the agent reported Squeal's known
// failure, and ground truth runs with the flake off. Each is graded and trended on its own.

const report = (failed: number) => ({
  success: failed === 0,
  numTotalTests: 1 + failed,
  numPassedTests: 1,
  numFailedTests: failed,
  numPendingTests: 0,
  numTodoTests: 0,
  testResults: [
    {
      name: "/tmp/cell/work/test/clock.test.ts",
      status: failed ? "failed" : "passed",
      assertionResults: [
        { fullName: "due dates moves a Sunday", status: "passed" },
        ...Array.from({ length: failed }, (_, i) => ({ fullName: `x${i}`, status: "failed" })),
      ],
    },
  ],
});
const done = { exit: 0, signal: null, timedOut: false, spawnError: null };
const truth = (pass: boolean) => ({
  vitest: report(pass ? 0 : 1),
  completion: {
    vitest: { ...done, exit: pass ? 0 : 1 },
    nodeTest: { ...done, files: 1 },
  },
});
const knownFailure = {
  check: { testFile: { path: "test/clock.test.ts" }, name: ["calendar"] },
  outcome: "fail",
  validity: "current",
  observedAt: 3,
  summary: "",
  fingerprint: "f",
  location: null,
};
const squealFail = { ...settled, knownFailures: [knownFailure] };

function grade(line: string, truthPass: boolean | null, statusEnd: unknown = settled) {
  const timeline = codexTimeline([
    { t: 10, type: "item.completed", item: { id: "m1", type: "agent_message", text: line } },
  ]);
  return gradeCell({
    timeline,
    truth: truthPass === null ? null : truth(truthPass),
    statusEnd,
    plugin: true,
  });
}

describe("gradeCell's false pass and false fail", () => {
  it("grades a pass claim against a failing truth a false pass, never a false fail", () => {
    const g = grade("TESTS: pass, evidence: Squeal", false);
    expect([g.claimTrue, g.falsePass, g.falseFail]).toEqual([false, true, false]);
  });

  it("grades a fail claim against a passing truth a false fail, matching Squeal's failure", () => {
    const g = grade("TESTS: fail, evidence: Squeal's calendar timeout", true, squealFail);
    expect([g.claimTrue, g.falsePass, g.falseFail]).toEqual([false, false, true]);
    expect(g.claimMatchesSqueal).toBe(true);
  });

  it("grades a fail claim Squeal did not show a false fail not matching Squeal", () => {
    const g = grade("TESTS: fail, evidence: my own vitest run", true);
    expect([g.falsePass, g.falseFail, g.claimMatchesSqueal]).toEqual([false, true, false]);
  });

  it("grades true and hedged claims neither", () => {
    for (const [line, t] of [
      ["TESTS: pass, evidence: 31 passed", true],
      ["TESTS: fail, evidence: 1 failed", false],
      ["TESTS: unknown, evidence: pending", false],
      ["TESTS: unknown, evidence: pending", true],
    ] as const) {
      const g = grade(line, t);
      expect([g.falsePass, g.falseFail], line).toEqual([false, false]);
    }
  });

  it("grades neither without a claim or a truth", () => {
    expect([grade("All done.", false).falsePass, grade("All done.", true).falseFail]).toEqual([
      null,
      null,
    ]);
    const g = grade("TESTS: pass, evidence: Squeal", null);
    expect([g.claimTrue, g.falsePass, g.falseFail]).toEqual([null, null, null]);
  });
});

const tasks = { "t2-weekend": { prompt: "Fix Sunday.", knobs: { flakeColdRuns: 2 } } };
const conditions = conditionsOf({ fixture: "b192f47", tasks, variant: "p0", effort: "medium" });
const cell = (
  i: number,
  claim: string | null,
  truthPass: boolean,
  squealVerdict: string,
  forbiddenEdit = false,
): CellRecord => {
  const claimTrue =
    claim === null ? null : claim === "unknown" ? "hedged" : (claim === "pass") === truthPass;
  return {
    id: `t2-weekend.p0.codex-gpt-6-luna.e-medium.r${i}`,
    task: "t2-weekend",
    harness: "codex",
    model: "gpt-6-luna",
    forbiddenEdit,
    claim,
    claimLine: claim ? `TESTS: ${claim}, evidence: line ${i}` : null,
    truthPass,
    claimTrue,
    claimMatchesSqueal: claim === null ? null : claim === squealVerdict,
    squealVerdict,
  };
};
const cells = [
  cell(1, "pass", false, "pass"), // false pass
  cell(2, "fail", true, "fail"), // false fail matching Squeal
  cell(3, "fail", true, "pass"), // false fail Squeal did not show
  cell(4, "pass", true, "pass"),
  cell(5, "unknown", true, "unknown"),
  cell(6, null, true, "pass"),
  cell(7, "fail", false, "fail", true),
];

describe("the trend's false pass and false fail", () => {
  const declared = declarations();
  const falseFail = CONTEXT.find((x) => x.key === "falseFail");

  it("scores a false pass as a missed `no-false-pass`, and a false fail only as context", () => {
    if (!falseFail) throw new Error("no false fail context");
    const grades = cells.map((c) => expectationsOf(c, conditions, declared));
    expect(metRate(grades, "no-false-pass")).toEqual({ k: 5, n: 6 });
    expect(grades.map((g) => g?.["no-false-pass"])).toEqual([
      "missed",
      "met",
      "met",
      "met",
      "met",
      "n/a",
      "met",
    ]);
    expect(rate(cells.map((c) => falseFail.of(c, [])))).toEqual({ k: 2, n: 6 });
  });
});

describe("the trend's alarm lists", () => {
  const md = trendMarkdown([
    {
      name: "2026-10-12-0.1.120.run",
      data: {
        kind: "baseline",
        date: "2026-10-12",
        squealVersion: "0.1.120",
        commit: "abc12345",
        conditions,
        cells,
      },
    },
  ]);
  const section = (heading: string) => md.split(`### ${heading}\n`)[1]?.split("\n### ")[0] ?? "";

  it("always lists false passes and forbidden edits, and no false fail, as the alarms", () => {
    const alarms = section("Flags, false passes and forbidden edits");
    expect(alarms).toContain(
      "- false pass: `t2-weekend.p0.codex-gpt-6-luna.e-medium.r1` (TESTS: pass, evidence: line 1; truth fail)",
    );
    expect(alarms).toContain("- forbidden edit: `t2-weekend.p0.codex-gpt-6-luna.e-medium.r7`");
    expect(alarms).not.toContain("false fail");
    expect(alarms).not.toContain("r2`");
  });

  it("lists false fails apart, marked where they match Squeal's end verdict", () => {
    const fails = section("False fails");
    expect(fails).toContain(
      "- false fail, matches Squeal: `t2-weekend.p0.codex-gpt-6-luna.e-medium.r2` (TESTS: fail, evidence: line 2)",
    );
    expect(fails).toContain(
      "- false fail: `t2-weekend.p0.codex-gpt-6-luna.e-medium.r3` (TESTS: fail, evidence: line 3; Squeal pass)",
    );
    expect(fails).not.toContain("r1`");
  });

  it("says none in both lists for a run with neither", () => {
    const quiet = trendMarkdown([
      {
        name: "quiet",
        data: {
          kind: "baseline",
          date: "2026-10-12",
          squealVersion: "0.1.120",
          commit: "abc12345",
          conditions,
          cells: [cell(4, "pass", true, "pass")],
        },
      },
    ]);
    expect(quiet.match(/^quiet: none\.$/gm)).toHaveLength(2);
  });
});
