import { describe, expect, it } from "vitest";
import { formatGateReport } from "../../src/cli/code-gate-text.js";
import type { GateFailedTests, GateFunctionReport } from "../../src/core/code/gate/report.js";
import { functionRow, gateReport } from "./code-gate-text-kit.js";

/*
 * Row 020-53 (#210): the text of a `test-failed` function whose loaders
 * hold no failed file. One such function says the failure is outside its
 * loaders on its own line; several with the same failed tests fold into one
 * line after the function lines. A failure in one of its own loaders reads
 * as before.
 */

const JSON_COMMAND = "squeal code --base origin/main --json";

const outside = (path: string, tests: string[], from: GateFailedTests["from"] = "run") => ({
  path,
  tests,
  from,
  loader: false,
});

/** #210's failure: one unrelated base test, outside every changed function's loaders. */
const UNRELATED: GateFailedTests[] = [outside("test/b.test.mjs", ["unrelated base test"])];

const failedRow = (over: Partial<GateFunctionReport>): GateFunctionReport =>
  functionRow({ state: "incomplete", gap: "test-failed", ...over });

/** The lines between the verdict line and the run lines of a report of `functions`. */
function functionLines(functions: GateFunctionReport[]): string[] {
  const report = gateReport({
    functions,
    verdict: "incomplete",
    counts: { pass: 0, violation: 0, incomplete: functions.length, skipped: 0, accepted: 0 },
  });
  const lines = formatGateReport(report, JSON_COMMAND).split("\n");
  return lines.slice(1, lines.indexOf(`JSON report: ${JSON_COMMAND}`));
}

describe("formatGateReport: a failure outside a function's loaders (row 020-53)", () => {
  it("says so on the line of the one function it blocks (#210)", () => {
    const callback = failedRow({
      path: "test/a.test.mjs",
      qualifiedName: "<test>",
      complexity: 1,
      coverage: { lines: 3, covered: 3, share: 1 },
      crap: 1,
      loaders: { expected: ["test/a.test.mjs"], measured: ["test/a.test.mjs"] },
      failedTests: UNRELATED,
    });
    expect(functionLines([callback])).toEqual([
      "  test/a.test.mjs:1  <test>  CC 1, coverage 100%, CRAP 1: incomplete: a selected test failed outside its loaders: test/b.test.mjs › unrelated base test",
    ]);
  });

  it("reads as before when one of its own loaders failed, even beside a failure outside", () => {
    const own = failedRow({
      failedTests: [
        outside("test/b.test.mjs", ["unrelated base test"]),
        { path: "test/a.test.ts", tests: ["a > breaks"], from: "run", loader: true },
      ],
    });
    expect(functionLines([own])).toEqual([
      "  src/a.ts:1  f  CC 3: incomplete: a selected test failed",
    ]);
  });

  it("folds several functions with the same failed tests into one bounded line after the others", () => {
    const failed = [
      outside("test/b.test.mjs", ["b one", "b two"], "store"),
      outside("test/c.test.mjs", ["c one"], "parts"),
    ];
    const lines = functionLines([
      failedRow({ qualifiedName: "first", line: 1, failedTests: failed }),
      failedRow({ qualifiedName: "stopped", line: 5, gap: "not-finished" }),
      failedRow({ qualifiedName: "second", line: 9, occurrence: 1, failedTests: failed }),
      failedRow({ path: "src/b.ts", qualifiedName: "third", line: 2, failedTests: failed }),
    ]);
    expect(lines).toEqual([
      "  src/a.ts:5  stopped  CC 3: incomplete: a test file that loads it did not finish in the budget",
      "  3 changed functions: incomplete: a selected test failed outside their loaders: test/b.test.mjs › b one and 2 more failed tests (first: src/a.ts:1 first; --json lists them all)",
    ]);
  });

  it("gives one line per set of failed tests, in the order of each set's first function", () => {
    const one = [outside("test/b.test.mjs", ["b one"])];
    const two = [outside("test/b.test.mjs", ["b one"]), outside("test/c.test.mjs", ["c one"])];
    const lines = functionLines([
      failedRow({ qualifiedName: "a1", line: 1, failedTests: two }),
      failedRow({ qualifiedName: "a2", line: 3, failedTests: one }),
      failedRow({ qualifiedName: "a3", line: 5, failedTests: two }),
      failedRow({ qualifiedName: "a4", line: 7, failedTests: one }),
      failedRow({ qualifiedName: "a5", line: 9, failedTests: [outside("test/d.test.mjs", ["d"])] }),
    ]);
    expect(lines).toEqual([
      "  src/a.ts:9  a5  CC 3: incomplete: a selected test failed outside its loaders: test/d.test.mjs › d",
      "  2 changed functions: incomplete: a selected test failed outside their loaders: test/b.test.mjs › b one and 1 more failed test (first: src/a.ts:1 a1; --json lists them all)",
      "  2 changed functions: incomplete: a selected test failed outside their loaders: test/b.test.mjs › b one (first: src/a.ts:3 a2; --json lists them all)",
    ]);
  });
});
