import { describe, expect, it } from "vitest";
import { preRunText } from "../../src/cli/code-gate-prerun.js";
import { formatGateReport } from "../../src/cli/code-gate-text.js";
import { leftOutCountText } from "../../src/cli/code-gate-text-left-out.js";
import type { SelectionSummary } from "../../src/core/code/gate/prerun.js";
import type { GateFunctionReport, GateReport } from "../../src/core/code/gate/report.js";
import type { LeftOutGroup } from "../../src/core/code/gate/scope.js";
import type { ChangedSet } from "../../src/core/code/gate/types.js";
import { functionRow, gateReport } from "./code-gate-text-kit.js";

/*
 * Spec 020 D14.3 (rows 020-15, 020-61, #203): what the verdict line says
 * the scope left out, the `--test` command for each edited test file it
 * left out, and the count words the pre-run line shares.
 */

const browser = (selected: number, over: Partial<LeftOutGroup> = {}): LeftOutGroup => ({
  name: "browser",
  at: "manual",
  files: 120,
  selected,
  add: "--group browser",
  ...over,
});

const E2E: LeftOutGroup = { name: "e2e", at: "stop", files: 4, selected: 0, add: "--group e2e" };

/** A changed source a left-out spec loads: incomplete, `left-out`. */
const source = functionRow({
  qualifiedName: "render",
  state: "incomplete",
  gap: "left-out",
  loaders: { expected: [], measured: [], leftOut: ["e2e/target.test.ts"] },
});

/** A changed callback in the left-out test file `path`: its own loader. */
const edited = (path: string): GateFunctionReport =>
  functionRow({
    path,
    qualifiedName: "it.<callback>",
    state: "incomplete",
    gap: "left-out",
    loaders: { expected: [], measured: [], leftOut: [path] },
  });

const report = (
  leftOut: readonly LeftOutGroup[],
  functions: readonly GateFunctionReport[] = [source],
): GateReport =>
  gateReport({
    verdict: "incomplete",
    functions,
    counts: { pass: 0, violation: 0, incomplete: functions.length, skipped: 0, accepted: 0 },
    scope: { groups: [{ name: "tests", at: "edit", from: "default" }], leftOut },
  });

const verdictLine = (r: GateReport) => formatGateReport(r, "j").split("\n")[0];

describe("the verdict line: what the scope left out (spec 020 D14.3)", () => {
  it("names each left-out group that held a selected file, and the flag that adds it", () => {
    expect(verdictLine(report([browser(100), E2E]))).toBe(
      "Code gate: incomplete. 1 changed function against origin/main (merge base 01234567): 1 incomplete. browser (manual) did not run: 100 test files load changed code; add --group browser to run them.",
    );
    expect(verdictLine(report([browser(1)]))).toMatch(
      / browser \(manual\) did not run: 1 test file loads changed code; add --group browser to run it\.$/,
    );
  });

  it("names none when no left-out group held a selected file", () => {
    expect(verdictLine(report([browser(0), E2E]))).toMatch(/: 1 incomplete\.$/);
  });
});

describe("the verdict line: --test for an edited test file left out (row 020-61, #203)", () => {
  it("names --test for the edited spec beside --group, and what still runs", () => {
    const line = verdictLine(report([browser(100)], [source, edited("e2e/target.test.ts")]));
    expect(line).toMatch(
      / browser \(manual\) did not run: 100 test files load changed code; add --group browser to run them\. To run only the edited test file of them, add --test e2e\/target\.test\.ts; the other selected test files in scope still run, with their setup\.$/,
    );
  });

  it("names each edited test file once, by path, and at most three", () => {
    const paths = ["e2e/d.test.ts", "e2e/a.test.ts", "e2e/c.test.ts", "e2e/b.test.ts"];
    const line = verdictLine(report([browser(4)], [...paths.map(edited), edited("e2e/a.test.ts")]));
    expect(line).toMatch(
      / To run only the edited test files of them, add --test e2e\/a\.test\.ts --test e2e\/b\.test\.ts --test e2e\/c\.test\.ts \(1 more edited test file: --json lists it under loaders\.leftOut\); the other selected test files in scope still run, with their setup\.$/,
    );
  });

  it("prints as before when no edited test file was left out", () => {
    expect(verdictLine(report([browser(100)]))).toMatch(/add --group browser to run them\.$/);
  });
});

describe("leftOutCountText: the count of a left-out group (row 020-61)", () => {
  it("counts the selected files it left out, as before", () => {
    expect(leftOutCountText(browser(0, { files: 3 }))).toBe(
      "none of its 3 test files loads changed code",
    );
    expect(leftOutCountText(browser(2, { files: 3 }))).toBe(
      "2 of its 3 test files load changed code; add --group browser to run them",
    );
  });

  it("after --test, says which files ran and counts only the others", () => {
    expect(leftOutCountText(browser(0, { files: 3, tests: 1 }))).toBe(
      "1 of its 3 test files runs by --test; none of the other 2 loads changed code",
    );
    expect(leftOutCountText(browser(1, { files: 4, tests: 2 }))).toBe(
      "2 of its 4 test files run by --test; 1 of the other 2 loads changed code; add --group browser to run it",
    );
    expect(leftOutCountText(browser(0, { files: 1, tests: 1 }))).toBe(
      "its 1 test file runs by --test",
    );
  });
});

describe("the pre-run left-out line after --test (row 020-61, #203)", () => {
  it("counts what was left out, not the file --test ran", () => {
    const summary: SelectionSummary = {
      runners: [],
      leftOut: [browser(0, { files: 3, tests: 1 })],
      setups: [],
      unloaded: [],
    };
    const changed = { functions: [] } as unknown as ChangedSet;
    expect(preRunText(summary, changed)).toContain(
      "browser (manual) is left out: 1 of its 3 test files runs by --test; none of the other 2 loads changed code",
    );
  });
});
