import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/index.js";
import { barredByTouch } from "../../src/core/scheduler/stability.js";
import type { CheckKey, RunReport, TestFileRef } from "../../src/core/types/index.js";

/*
 * Task 013-02 (D2 of 013-01, 011 C2 as amended 2026-10-20): the completion
 * barrier withholds the files whose keys name a touched path, among their
 * inputs or what their run read beyond them, and stores the rest. Row
 * 011-47 moved that narrowing from `Scheduler.#record` into `stability.ts`,
 * so the validity comparison's `store` kind runs it (task 011-37 risk 4).
 */

const refOf = (path: string): TestFileRef => ({ project: "", path });
const file = (path: string, inputs: string[]) => ({
  file: { id: testFileId(refOf(path)), ref: refOf(path) },
  key: `k:${path}` as CheckKey,
  inputs,
});

const A = "test/a.test.ts";
const B = "test/b.test.ts";
const C = "test/c.test.ts";
const FILES = [file(A, [A, "src/a.ts"]), file(B, [B, "src/b.ts"]), file(C, [C])];

const ran: RunReport = {
  end: "completed",
  durationMs: 10,
  completedFiles: [A, B, C].map(refOf),
  results: [A, B, C].map((path) => ({
    check: { kind: "test", project: "", testPath: path, fullName: "passes" },
    outcome: "pass",
    durationMs: 1,
    location: null,
    errors: [],
  })),
  fileErrors: [],
  failure: null,
};

const paths = (report: RunReport) => report.completedFiles.map((ref) => ref.path);

describe("barredByTouch", () => {
  it("withholds only the files whose inputs name a touched path", () => {
    const { report, barred, paths: named } = barredByTouch(ran, FILES, ["src/b.ts", "dist/x.js"]);
    expect(barred.map((f) => f.file.ref.path)).toEqual([B]);
    expect(named).toEqual(["src/b.ts"]);
    expect(paths(report)).toEqual([A, C]);
    expect(report.results.map((r) => r.check.testPath)).toEqual([A, C]);
    expect(report.failure).toContain("src/b.ts");
    expect(report.failure).not.toContain("dist/x.js");
  });

  it("withholds a file whose run read the touched path beyond its inputs", () => {
    const growth = new Map([[testFileId(refOf(C)), { growth: ["fixtures/c.json"] }]]);
    const { barred, paths: named } = barredByTouch(
      ran,
      FILES,
      ["fixtures/c.json", "src/a.ts"],
      growth,
    );
    expect(barred.map((f) => f.file.ref.path)).toEqual([A, C]);
    expect(named).toEqual(["fixtures/c.json", "src/a.ts"]);
  });

  it("stores the whole run when no file's keys name a touched path", () => {
    const { report, barred } = barredByTouch(ran, FILES, ["dist/x.js"]);
    expect(barred).toEqual([]);
    expect(report).toBe(ran);
  });
});
