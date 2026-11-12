import { describe, expect, it } from "vitest";
import { formatGateReport } from "../../src/cli/code-gate-text.js";
import { gateReport } from "./code-gate-text-kit.js";

/*
 * Spec 020 row 020-43 (#196): the text report tells a file that started
 * and was stopped at the budget from those that never started. The first
 * keeps its own line; the others are counted in one line per runner, as
 * #198's 1,329 lines of the same words showed, and `--json` lists them in
 * `runs[].notStarted`.
 */

describe("formatGateReport: stopped against never started (row 020-43)", () => {
  it("names each stopped file and counts the files that never started", () => {
    const report = gateReport({
      budget: { seconds: 25, timedOut: true },
      runs: [
        {
          runner: "vitest",
          selected: ["test/a.test.ts"],
          completed: [],
          notFinished: ["test/a.test.ts"],
          notStarted: ["test/a.test.ts"],
          failed: [],
          durationMs: null,
        },
        {
          runner: "node-test",
          selected: ["n1/slow.test.ts", "n2/c1.test.ts", "n2/c2.test.ts"],
          completed: [],
          notFinished: ["n1/slow.test.ts", "n2/c1.test.ts", "n2/c2.test.ts"],
          notStarted: ["n2/c1.test.ts", "n2/c2.test.ts"],
          failed: [],
          durationMs: 25_000,
        },
      ],
      verdict: "incomplete",
    });

    const runLines = formatGateReport(report, "json").split("\n").slice(1, -2);

    expect(runLines).toEqual([
      "  1 Vitest test file did not start in the 25 s budget; --json lists them",
      "  n1/slow.test.ts: did not finish in the 25 s budget",
      "  2 node:test test files did not start in the 25 s budget; --json lists them",
    ]);
  });
});
