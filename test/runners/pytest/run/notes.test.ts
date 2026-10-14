import { describe, expect, it } from "vitest";
import type {
  CheckRunResult,
  PytestProject,
  RunOutcome,
} from "../../../../src/core/types/index.js";
import type { PytestFileReport } from "../../../../src/runners/pytest/run/report.js";
import { allSkippedNote } from "../../../../src/runners/pytest/run/run.js";

/*
 * Spec 007 D3: "A project whose run skipped every collected test gets one
 * note, since pytest exits 0 then" (review 007-16 S1). The live run is in
 * run.test.ts; these separate it from a run that collected nothing.
 */

const PROJECT: PytestProject = { name: "small", args: [], env: {}, include: [] };
const testFile = (path: string) => ({ project: "small", path });

const result = (path: string, name: string, outcome: RunOutcome): CheckRunResult =>
  ({ check: { testFile: testFile(path), fullName: name }, outcome }) as unknown as CheckRunResult;

function file(path: string, extra: Partial<PytestFileReport> = {}): PytestFileReport {
  return {
    testFile: testFile(path),
    completed: true,
    results: [],
    fileError: null,
    skipped: null,
    durationMs: 0,
    ...extra,
  };
}

describe("allSkippedNote (spec 007 D3)", () => {
  it("notes a run whose skips, xfails and module skips are every outcome", () => {
    const files = [
      file("a.py", {
        results: [result("a.py", "test_skip", "skip"), result("a.py", "test_xfail", "skip")],
      }),
      file("b.py", { skipped: "the whole module" }),
    ];
    expect(allSkippedNote(PROJECT, files)).toBe(
      'pytest project "small" skipped every collected test (3 skipped) in 2 files; pytest exits 0 then, so check what skips them (a missing setting or service often does).',
    );
  });

  it("is null when one test did not skip", () => {
    const files = [
      file("a.py", { results: [result("a.py", "t1", "skip"), result("a.py", "t2", "pass")] }),
    ];
    expect(allSkippedNote(PROJECT, files)).toBeNull();
  });

  it("is null for a run that collected nothing, or no file", () => {
    expect(allSkippedNote(PROJECT, [file("a.py")])).toBeNull();
    expect(allSkippedNote(PROJECT, [])).toBeNull();
  });

  it("is null when a file failed to collect beside the skips", () => {
    const files = [
      file("a.py", { results: [result("a.py", "t", "skip")] }),
      file("b.py", { fileError: { testFile: testFile("b.py"), errors: [] } }),
    ];
    expect(allSkippedNote(PROJECT, files)).toBeNull();
  });
});
