import { describe, expect, it } from "vitest";
import type { RunReport } from "../../src/core/types/index.js";
import { runLogJson } from "../../src/runners/run-summary.js";

/*
 * Row 011-164 (001 D8 as amended 2026-10-23): a run log keeps the report's
 * summary only, on one line; each check's result and the observed paths live
 * only in the store.
 */
describe("run log summary", () => {
  const file = { project: "unit", path: "test/a.test.ts" };
  const error = { name: "Error", message: "boom", stack: null, location: null, diff: null };
  const report = {
    end: "completed",
    durationMs: 1200,
    completedFiles: [file],
    results: [
      {
        check: { testFile: file, fullName: "a" },
        outcome: "pass",
        durationMs: 3,
        location: null,
        errors: [],
      },
    ],
    fileErrors: [{ testFile: file, errors: [error] }],
    failure: "cancelled",
    fileDurations: [{ testFile: file, durationMs: 1000 }],
    observed: [{ testFile: file, paths: ["src/a.ts"], directories: [] }],
    reads: [{ testFile: file, paths: ["src/b.ts"], directories: [] }],
    environmentObserved: [],
    skippedFiles: [{ testFile: file, reason: "skip" }],
    startedProjects: ["unit"],
    withheld: [],
    focused: [],
  } as unknown as RunReport;

  it("keeps the summary fields and the caller's own, without results or observed paths", () => {
    const text = runLogJson({ runId: "r1" }, report);
    expect(JSON.parse(text)).toEqual({
      runId: "r1",
      report: {
        end: "completed",
        failure: "cancelled",
        durationMs: 1200,
        fileDurations: [{ testFile: file, durationMs: 1000 }],
        completedFiles: [file],
        fileErrors: [{ testFile: file, errors: [error] }],
        startedProjects: ["unit"],
      },
    });
  });

  it("writes one line of JSON", () => {
    const text = runLogJson({ cwd: "/w", files: [] }, report);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.trimEnd()).not.toContain("\n");
  });

  it("leaves out an optional field the report lacks", () => {
    const { fileDurations: _d, startedProjects: _s, ...bare } = report;
    const saved = JSON.parse(runLogJson({}, bare)).report as Record<string, unknown>;
    expect(Object.keys(saved).sort()).toEqual([
      "completedFiles",
      "durationMs",
      "end",
      "failure",
      "fileErrors",
    ]);
  });
});
