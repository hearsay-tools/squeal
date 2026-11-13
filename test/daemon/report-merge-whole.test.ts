import { describe, expect, it } from "vitest";
import { merge } from "../../src/core/daemon/composite-runner.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { RunReport } from "../../src/core/types/runner.js";
import {
  A,
  B,
  C,
  duration,
  EMPTY,
  env,
  fileError,
  focus,
  parts,
  result,
  seen,
  setupFailure,
  skip,
} from "./report-merge-fixture.js";

/*
 * The report merge (row 011-330) over whole reports, beside the table of one
 * rule per field (`report-merge.test.ts`): no part, two parts that each
 * failed to start, and three parts that set every field.
 */

describe("the report merge over whole reports", () => {
  it("is an empty completed report over no part, as a run that started none", () => {
    expect(merge([])).toStrictEqual(EMPTY);
  });

  it("keeps the first of two setup failures and names both parts' failures (task 001-382)", () => {
    const failed = (project: string, testFiles: readonly TestFileRef[]): Partial<RunReport> => ({
      durationMs: 2,
      failure: `global setup ${project}/setup.ts failed`,
      startupFailure: setupFailure(project, testFiles),
    });
    expect(merge(parts([failed("unit", [A, B]), failed("node", [C])]))).toStrictEqual({
      ...EMPTY,
      durationMs: 4,
      failure:
        "vitest: global setup unit/setup.ts failed; node-test: global setup node/setup.ts failed",
      startupFailure: setupFailure("unit", [A, B]),
    });
  });

  it("merges three parts that set every field, in today's key order", () => {
    const full = (file: TestFileRef, end: RunReport["end"], project: string): RunReport => ({
      end,
      durationMs: 3,
      completedFiles: [file],
      results: [result(file)],
      fileErrors: [fileError(file)],
      failure: end === "completed" ? null : `${file.path} ${end}`,
      fileDurations: [duration(file)],
      observed: [seen(file)],
      reads: [seen(file)],
      environmentObserved: [env(project)],
      skippedFiles: [skip(file)],
      startupFailure: setupFailure(project, [file]),
      startedProjects: [project],
      withheld: [file],
      focused: [focus(file, 1)],
    });
    const merged = merge([
      { adapter: { name: "vitest" }, report: full(A, "completed", "unit") },
      { adapter: { name: "node-test" }, report: full(C, "timed-out", "node") },
      { adapter: { name: "pytest" }, report: full(B, "completed", "py") },
    ]);
    const files = [A, C, B];
    const expected = {
      end: "timed-out",
      durationMs: 9,
      completedFiles: files,
      results: files.map(result),
      fileErrors: files.map(fileError),
      failure: "node-test: test/c.test.ts timed-out",
      fileDurations: files.map(duration),
      observed: files.map(seen),
      reads: files.map(seen),
      environmentObserved: ["unit", "node", "py"].map(env),
      skippedFiles: files.map(skip),
      withheld: files,
      focused: files.map((file) => focus(file, 1)),
      startupFailure: setupFailure("unit", [A]),
      startedProjects: ["node", "py", "unit"],
    };
    expect(merged).toStrictEqual(expected);
    // A report written as JSON keeps its bytes: the keys come in the same order.
    expect(Object.keys(merged)).toEqual(Object.keys(expected));
  });
});
