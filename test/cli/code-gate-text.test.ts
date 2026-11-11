import { describe, expect, it } from "vitest";
import { crapText, formatGateReport } from "../../src/cli/code-gate-text.js";
import type {
  GateExceptionUse,
  GateFunctionReport,
  GateReport,
} from "../../src/core/code/gate/report.js";
import type { ExceptionEntry } from "../../src/core/code/gate/types.js";
import { functionRow, gateReport } from "./code-gate-text-kit.js";

/*
 * Spec 020 D1, D8 and D14.3: the text of `squeal code --base`'s report,
 * from reports built here, for the lines the end-to-end runs do not reach.
 */

describe("crapText (spec 020 D1: CRAP is rounded for display only)", () => {
  it.each([
    [42, 30, "42"],
    [34.567, 30, "34.6"],
    [30.04, 30, "30.04"],
    [30.0004, 30, "30.0004"],
    [29.96, 30, "30.0"],
  ])("shows %d against %d as %s", (value, limit, text) => {
    expect(crapText(value, limit)).toBe(text);
  });
});

/** Four changed functions not all pass, a path not counted, and a run the budget stopped. */
const REPORT: GateReport = gateReport({
  budget: { seconds: 600, timedOut: true },
  functions: [
    functionRow({ qualifiedName: "ok", state: "pass" }),
    functionRow({ path: "scripts/run.ts", qualifiedName: "main", line: 4, state: "skipped" }),
    functionRow({
      qualifiedName: "it.<callback>",
      occurrence: 1,
      line: 9,
      state: "incomplete",
      gap: "not-finished",
    }),
    functionRow({
      qualifiedName: "covered",
      line: 20,
      coverage: { lines: 4, covered: 3, share: 0.75 },
      crap: 3.0469,
      state: "incomplete",
      gap: "test-failed",
    }),
  ],
  uncounted: [{ path: "src/big.ts", reason: "too-large", gap: "not-counted" }],
  runs: [
    {
      runner: "vitest",
      selected: ["test/a.test.ts", "test/slow.test.ts"],
      completed: ["test/a.test.ts"],
      notFinished: ["test/slow.test.ts"],
      failed: [{ path: "test/a.test.ts", tests: ["a", "b", "c", "d"] }],
      durationMs: 1200,
    },
  ],
  verdict: "incomplete",
  counts: { pass: 1, violation: 0, incomplete: 2, skipped: 1, accepted: 0 },
});

describe("formatGateReport (spec 020 D1)", () => {
  it("prints the verdict, the functions that are not pass, the paths and runs, then the JSON command", () => {
    expect(formatGateReport(REPORT, "squeal code --base origin/main --json").split("\n")).toEqual([
      "Code gate: incomplete. 4 changed functions against origin/main (merge base 01234567): 2 incomplete, 1 skipped, 1 pass, 1 path not counted.",
      "  scripts/run.ts:4  main  CC 3: skipped: its file is in coverage.exclude",
      "  src/a.ts:9  it.<callback> (occurrence 2)  CC 3: incomplete: a test file that loads it did not finish in the budget",
      "  src/a.ts:20  covered  CC 3, coverage 75%, CRAP 3.0: incomplete: a selected test failed",
      "  src/big.ts: over complexity.maxFileBytes, not counted",
      "  test/a.test.ts: failed: a; b; c and 1 more",
      "  test/slow.test.ts: did not finish in the 600 s budget",
      "JSON report: squeal code --base origin/main --json",
      "",
    ]);
  });

  it("says no function changed when none did", () => {
    const empty = {
      ...REPORT,
      functions: [],
      uncounted: [],
      runs: [],
      verdict: "pass",
      counts: { pass: 0, violation: 0, incomplete: 0, skipped: 0, accepted: 0 },
    } as const;
    expect(formatGateReport(empty, "squeal code --base main --json")).toBe(
      "Code gate: pass. No function changed against origin/main (merge base 01234567).\nJSON report: squeal code --base main --json\n",
    );
  });
});

describe("formatGateReport: what the scope left out (spec 020 D14.3)", () => {
  const scoped = (selected: number): GateReport => ({
    ...REPORT,
    scope: {
      groups: [{ name: "tests", at: "edit", from: "default" }],
      leftOut: [
        { name: "browser", at: "manual", files: 120, selected, add: "--group browser" },
        { name: "e2e", at: "stop", files: 4, selected: 0, add: "--group e2e" },
      ],
    },
  });

  it("names each left-out group that held a selected file on the verdict line", () => {
    const [line] = formatGateReport(scoped(100), "j").split("\n");
    expect(line).toBe(
      "Code gate: incomplete. 4 changed functions against origin/main (merge base 01234567): 2 incomplete, 1 skipped, 1 pass, 1 path not counted. browser (manual) did not run: 100 test files load changed code; add --group browser to run them.",
    );
    expect(formatGateReport(scoped(1), "j").split("\n")[0]).toMatch(
      / browser \(manual\) did not run: 1 test file loads changed code; add --group browser to run it\.$/,
    );
  });

  it("names none when no left-out group held a selected file", () => {
    const [line] = formatGateReport(scoped(0), "j").split("\n");
    expect(line).toMatch(/1 path not counted\.$/);
  });
});

/** A changed function with the exceptions that name it. */
const used = (
  over: Partial<GateFunctionReport>,
  exceptions: readonly GateExceptionUse[],
): GateFunctionReport => functionRow({ ...over, exceptions });

describe("formatGateReport: exceptions (spec 020 D8)", () => {
  const entry = (over: Partial<ExceptionEntry>): ExceptionEntry => ({
    path: "src/a.ts",
    qualifiedName: "f",
    bodyHash: "h",
    measure: "complexity",
    kind: "inherited",
    value: 22,
    issue: "https://github.com/o/r/issues/7",
    approver: "owner",
    baseCommit: "0123456789abcdef",
    ...over,
  });
  const use = (
    entry: ExceptionEntry,
    outcome: GateExceptionUse["outcome"],
    baseComplexity: number | null,
  ): GateExceptionUse => ({ entry, outcome, baseComplexity });
  const kept = entry({ qualifiedName: "kept" });
  const fresh = entry({ qualifiedName: "fresh", measure: "crap", kind: "approved", value: 42 });

  it("names the entry of each accepted function, why one does not cover a violation, and the unused", () => {
    const report: GateReport = gateReport({
      functions: [
        used({ qualifiedName: "kept", complexity: 22, state: "accepted", line: 2 }, [
          use(kept, "covers", 22),
        ]),
        used(
          {
            qualifiedName: "fresh",
            line: 3,
            complexity: 6,
            coverage: { lines: 4, covered: 0, share: 0 },
            crap: 42,
            state: "accepted",
          },
          [use(fresh, "covers", null)],
        ),
        used({ qualifiedName: "grown", complexity: 23, state: "violation", line: 4 }, [
          use(entry({ qualifiedName: "grown" }), "worse-than-base", 22),
        ]),
        used({ qualifiedName: "cleaned", complexity: 21, state: "violation", line: 5 }, [
          use(entry({ qualifiedName: "cleaned" }), "not-over-at-base", 20),
        ]),
        used({ qualifiedName: "stale", complexity: 21, state: "violation", line: 6 }, [
          use(entry({ qualifiedName: "stale", value: 25 }), "over-value", 30),
        ]),
        used({ qualifiedName: "moved", complexity: 26, state: "violation", line: 7 }, [
          use(entry({ qualifiedName: "moved" }), "not-at-base", null),
          use(entry({ qualifiedName: "moved", kind: "approved", value: 25 }), "over-value", null),
        ]),
      ],
      exceptions: {
        unused: [
          { entry: entry({ qualifiedName: "old" }), why: "base-commit" },
          { entry: entry({ qualifiedName: "kept", bodyHash: "x" }), why: "body-hash" },
        ],
      },
      verdict: "violations",
      counts: { pass: 0, violation: 4, incomplete: 0, skipped: 0, accepted: 2 },
    });
    expect(formatGateReport(report, "j").split("\n")).toEqual([
      "Code gate: violations. 6 changed functions against origin/main (merge base 01234567): 4 violations, 2 accepted, 2 exceptions unused.",
      "  src/a.ts:2  kept  CC 22 over 20: accepted: inherited complexity exception, https://github.com/o/r/issues/7",
      "  src/a.ts:3  fresh  CC 6, coverage 0%, CRAP 42 over 30: accepted: approved crap exception, https://github.com/o/r/issues/7",
      "  src/a.ts:4  grown  CC 23 over 20: violation; inherited complexity exception does not cover it: CC is over the base's 22",
      "  src/a.ts:5  cleaned  CC 21 over 20: violation; inherited complexity exception does not cover it: CC 20 at the base is not over 20",
      "  src/a.ts:6  stale  CC 21 over 20: violation; inherited complexity exception does not cover it: CC 30 at the base is over its value 25",
      "  src/a.ts:7  moved  CC 26 over 20: violation; inherited complexity exception does not cover it: the function is not at the base; approved complexity exception does not cover it: CC is over its value 25",
      "  inherited complexity exception for src/a.ts old: unused: its base commit is not the merge base",
      "  inherited complexity exception for src/a.ts kept: unused: the changed function of that name has another body hash",
      "JSON report: j",
      "",
    ]);
  });
});
