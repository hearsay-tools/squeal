import { describe, expect, it } from "vitest";
import {
  formatProof,
  jsonProof,
  type ProofFile,
  type ProofReport,
} from "../../src/cli/proof-report.js";
import type { SideFile } from "../../src/cli/proof-side.js";
import { type Conditions, NO_CONDITIONS } from "../../src/core/proof/conditions.js";
import { NOT_RUN_BUDGET, NOT_SHOWN_TO_MATTER } from "../../src/core/proof/verdict.js";

/*
 * Row 023-20, lessons P7 and P9: the proof report's words for a side that
 * did not run, and the control run's one line under a condition. Reports
 * built by hand; the fixture tests (`proof.test.ts`,
 * `proof-conditions.test.ts`) run the same through the command.
 */

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const ENV: Conditions = { ...NO_CONDITIONS, env: [{ name: "CI", value: null }] };

const ran = (end: SideFile["end"], stored = true): SideFile => ({
  end,
  from: "run",
  stored,
  notStored: stored ? null : "a side under a condition is never stored",
  runs: 1,
});
const assertionFail: SideFile["end"] = {
  end: "fail",
  failures: [
    {
      test: "t",
      errors: [
        {
          name: "AssertionError",
          message: "expected 1 to be 2",
          stack: null,
          location: null,
          diff: null,
          stage: "body",
        },
      ],
    },
  ],
};

function file(more: Partial<ProofFile>): ProofFile {
  return {
    ref: { project: "", path: "test/a.test.ts" },
    verdict: "not red",
    reason: null,
    evidence: null,
    red: ran({ end: "pass" }),
    green: null,
    greenNotRun: "red passed: nothing to prove",
    control: null,
    controlNotRun: null,
    imports: null,
    ...more,
  };
}

function report(files: readonly ProofFile[], conditions: Conditions = NO_CONDITIONS): ProofReport {
  return {
    case: conditions === NO_CONDITIONS ? "source" : "dependency",
    base: BASE,
    head: HEAD,
    red: { tests: HEAD, code: BASE },
    green: { tests: HEAD, code: HEAD },
    checkoutMs: { red: 1000, control: null, green: 1000 },
    dirty: [],
    timeoutSeconds: 300,
    usedMs: 2000,
    runs: 1,
    files,
    conditions,
    repeat: 1,
    redErrors: [],
    notRun: 0,
    rerun: null,
    with: [],
    withUnused: [],
    withRerun: null,
    source: [],
    sourceUnused: [],
    sourceRerun: null,
  };
}

describe("proof report: sides not run and the control run (row 023-20)", () => {
  it("says why the green side did not run, never 'not read' (P7)", () => {
    const text = formatProof(report([file({})]));
    // Row 023-24 (Q6): what the proof does not show, and where the result now is.
    expect(text).toContain(
      "  green: not run. Red passed, so this proof says nothing about HEAD; `squeal status test/a.test.ts` gives its result now.\n",
    );
    expect(text).not.toContain("not read");
    const json = JSON.parse(jsonProof(report([file({})])));
    expect(json.files[0]).toMatchObject({
      green: null,
      greenNotRun: "red passed: nothing to prove",
    });
  });

  it("names a red side the budget left not started as not run, not unknown (P7)", () => {
    const red: SideFile = {
      end: { end: "unknown", reason: NOT_RUN_BUDGET },
      from: null,
      stored: false,
      notStored: null,
      runs: 0,
    };
    const text = formatProof(
      report([
        file({
          verdict: "not comparable",
          reason: "budget",
          red,
          greenNotRun: "red not run (budget): nothing to compare",
        }),
      ]),
    );
    expect(text).toContain("  red: not run (budget)\n");
    expect(text).toContain("  green: not run (red not run (budget): nothing to compare)\n");
  });

  it("adds 'red only under the conditions' when the red side passes without them (P9)", () => {
    const f = file({
      verdict: "proven",
      red: ran(assertionFail, false),
      green: ran({ end: "pass" }, false),
      greenNotRun: null,
      control: ran({ end: "pass" }),
    });
    const text = formatProof(report([f], ENV));
    expect(text).toContain("test/a.test.ts: proven\n");
    expect(text).toContain(
      "  red only under the conditions (without them: pass, run by this command, stored)\n",
    );
    const json = JSON.parse(jsonProof(report([f], ENV)));
    expect(json.files[0]).toMatchObject({
      controlReading: "red only under the conditions",
      control: { end: "pass", from: "run", stored: true },
      controlNotRun: null,
    });
  });

  it("adds 'red without them too' and the verdict's reason when it fails without them (P9)", () => {
    const f = file({
      verdict: "proven",
      reason: NOT_SHOWN_TO_MATTER,
      red: ran(assertionFail, false),
      green: ran({ end: "pass" }, false),
      greenNotRun: null,
      control: { ...ran(assertionFail), from: "store", runs: 0 },
    });
    const text = formatProof(report([f], ENV));
    expect(text).toContain(
      "test/a.test.ts: proven (red without the conditions too: the conditions are not shown to matter)\n",
    );
    expect(text).toContain("  red without them too (without them: fail, stored result)\n");
  });

  it("says why the control run did not run, and nothing about it with no condition (P9)", () => {
    const f = file({ controlNotRun: "red passed: nothing to prove" });
    expect(formatProof(report([f], ENV))).toContain(
      "  without the conditions: not run (red passed: nothing to prove)\n",
    );
    expect(formatProof(report([file({})]))).not.toContain("without the conditions");
  });
});

describe("proof report: what a side does not show (row 023-24, Q5 and Q6)", () => {
  const base = BASE.slice(0, 9);
  const redNote = `  red is the test at ${HEAD.slice(0, 9)} over the code at ${base}, not the file's own result at ${base}; that is \`squeal status --at ${base} test/a.test.ts\`.\n`;
  const proven = file({
    verdict: "proven",
    red: ran(assertionFail),
    green: ran({ end: "pass" }),
    greenNotRun: null,
  });

  it("says a source-case red side of a changed test is not the file's result at the base (Q5)", () => {
    const text = formatProof(report([proven]));
    expect(text).toContain(redNote);
    // After the red side and its failures, before the green side.
    expect(text.indexOf(redNote)).toBeGreaterThan(text.indexOf("[assertion]"));
    expect(text.indexOf(redNote)).toBeLessThan(text.indexOf("  green: pass"));
  });

  it("says nothing of it for an unchanged test, the test case, or a red side with no outcome (Q5)", () => {
    const unchanged = { ...proven, imports: { unsettled: [], sources: ["src/a.ts"], read: [] } };
    expect(formatProof(report([unchanged]))).not.toContain("not the file's own result");
    const testCase = {
      ...report([proven]),
      case: "test" as const,
      red: { tests: BASE, code: HEAD },
    };
    expect(formatProof(testCase)).not.toContain("not the file's own result");
    const unknown = file({
      verdict: "not comparable",
      red: {
        end: { end: "unknown", reason: NOT_RUN_BUDGET },
        from: null,
        stored: false,
        notStored: null,
        runs: 0,
      },
      greenNotRun: "red not run (budget): nothing to compare",
    });
    expect(formatProof(report([unknown]))).not.toContain("not the file's own result");
  });

  it("says what a red side that failed for another reason does not show (Q6), JSON unchanged", () => {
    const other = file({
      verdict: "red for another reason",
      reason: "the budget stopped the red side",
      red: ran({ end: "timeout" }),
      greenNotRun: "red failed for another reason: nothing to prove",
    });
    const text = formatProof(report([other]));
    expect(text).toContain(
      "  green: not run. Red failed for another reason, so this proof shows neither that the test catches the change nor its result at HEAD; `squeal status test/a.test.ts` gives its result now.\n",
    );
    expect(JSON.parse(jsonProof(report([other]))).files[0].greenNotRun).toBe(
      "red failed for another reason: nothing to prove",
    );
  });
});
