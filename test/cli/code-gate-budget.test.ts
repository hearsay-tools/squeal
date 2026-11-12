import { describe, expect, it } from "vitest";
import { parseGateArgs } from "../../src/cli/code-gate-args.js";
import { budgetLine, estimateText, rerunCommand } from "../../src/cli/code-gate-prerun.js";
import { formatGateReport } from "../../src/cli/code-gate-text.js";
import type { BudgetFit } from "../../src/core/code/gate/estimate.js";
import type { BudgetTold } from "../../src/core/code/gate/plan.js";
import { shellWord } from "../../src/core/text.js";
import { gateReport } from "./code-gate-text-kit.js";

/*
 * Rows 020-45 and 020-46 (#196, #198): when the estimate is over what is
 * left of the budget, `squeal code --base` names one rerun command, the
 * call's own arguments with a `--timeout` that fits, on stderr before the
 * first run and in the report. At twice what is left, the stderr line
 * says which files the gate runs and which it stops before, and the
 * report counts and names those per runner.
 */

/** The rerun command of `args`, run as `squeal`. */
function rerun(args: readonly string[], seconds: number): string {
  const parsed = parseGateArgs(args);
  if ("error" in parsed) throw new Error(parsed.error);
  return rerunCommand(parsed, "squeal")(seconds);
}

const FIT: BudgetFit = { leftSeconds: 590, seconds: 700, known: 40, rerunSeconds: 1440 };
const RERUN = { seconds: 1440, command: "squeal code --base main --timeout 1440" };

describe("rerunCommand", () => {
  it("is the call's own arguments with the fitted --timeout in place of the one given", () => {
    expect(rerun(["--base", "origin/main", "--timeout", "600", "--json"], 1440)).toBe(
      "squeal code --base origin/main --timeout 1440 --json",
    );
  });

  it("keeps the paths, --test, --group, --parts and --exceptions in an order that parses the same", () => {
    const args = [
      "--base=main",
      "src",
      "--test",
      "test/a.test.ts",
      "--group",
      "unit",
      "e2e",
      "--parts",
      "parts dir",
      "--exceptions",
      "ex.json",
    ];
    const command = rerun(args, 900);
    expect(command).toBe(
      "squeal code --base main src --test test/a.test.ts --group unit e2e --parts 'parts dir' --exceptions ex.json --timeout 900",
    );
    // The command's words, unquoted, parse as the call did, with the new budget.
    const words = [
      ...["--base", "main", "src", "--test", "test/a.test.ts", "--group", "unit", "e2e"],
      ...["--parts", "parts dir", "--exceptions", "ex.json", "--timeout", "900"],
    ];
    expect(command).toBe(`squeal code ${words.map(shellWord).join(" ")}`);
    expect(parseGateArgs(words)).toEqual({ ...parseGateArgs(args), budgetSeconds: 900 });
  });
});

describe("budgetLine", () => {
  it("names the rerun when the run is over what is left", () => {
    expect(budgetLine({ fit: FIT, rerun: RERUN })).toBe(
      "about 700 s in all, over the 590 s left of the budget. A rerun that fits: squeal code --base main --timeout 1440",
    );
  });

  it("says nothing when the run fits or its time is unknown", () => {
    expect(budgetLine({ fit: { leftSeconds: 590, seconds: 100, known: 3 } })).toBeNull();
    expect(budgetLine({ fit: { leftSeconds: 590, seconds: null, known: 0 } })).toBeNull();
  });

  it("at twice what is left, says which files run and names the first three it stops before", () => {
    const overBudget = ["test/c1.test.ts", "test/c2.test.ts", "test/c3.test.ts", "test/c4.test.ts"];
    const told: BudgetTold = {
      fit: { ...FIT, seconds: 1400, rerunSeconds: 2820, early: true },
      rerun: { seconds: 2820, command: "squeal code --base main --timeout 2820" },
      early: { run: 2, overBudget },
    };
    expect(budgetLine(told)).toBe(
      "about 1400 s in all, at least twice the 590 s left of the budget, so the gate stops early: it runs the 2 test files that may load a changed function, and not the 4 that load none (test/c1.test.ts, test/c2.test.ts, test/c3.test.ts and 1 more; the report lists them all). A rerun that runs them all: squeal code --base main --timeout 2820",
    );
  });

  it("follows the runners' lines in the estimate's text", () => {
    const estimates = [{ runner: "vitest", seconds: 700, files: 40, known: 40, width: 4 }] as const;
    const text = estimateText(estimates, 590, { fit: FIT, rerun: RERUN });
    const lines = text.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^squeal code: Vitest: 40 test files to run here.*over the 590 s left/,
    );
    expect(lines[1]).toBe(`squeal code: ${budgetLine({ fit: FIT, rerun: RERUN })}`);
    expect(estimateText(estimates, 800, { fit: { ...FIT, leftSeconds: 800 } })).not.toMatch(
      /rerun/i,
    );
  });
});

describe("formatGateReport: the rerun and the files not run", () => {
  it("names the rerun before the JSON command, and counts each runner's files not run", () => {
    const overBudget = ["test/c1.test.ts", "test/c2.test.ts", "test/c3.test.ts", "test/c4.test.ts"];
    const report = gateReport({
      budget: { seconds: 600, timedOut: false, rerun: RERUN },
      runs: [
        {
          runner: "vitest",
          selected: ["test/a.test.ts", ...overBudget],
          completed: ["test/a.test.ts"],
          notFinished: [],
          failed: [],
          overBudget,
          durationMs: 1000,
        },
      ],
      verdict: "incomplete",
    });
    const lines = formatGateReport(report, "squeal code --base main --json").trimEnd().split("\n");
    expect(lines.slice(1)).toEqual([
      "  4 Vitest test files did not run: the estimate was at least twice what was left of the budget, and they load no changed function (test/c1.test.ts, test/c2.test.ts, test/c3.test.ts and 1 more; --json lists them all)",
      "A rerun that fits the estimate: squeal code --base main --timeout 1440",
      "JSON report: squeal code --base main --json",
    ]);
  });

  it("adds no line when the run fit", () => {
    const text = formatGateReport(gateReport(), "squeal code --base main --json");
    expect(text).not.toMatch(/rerun|did not run/i);
  });
});
