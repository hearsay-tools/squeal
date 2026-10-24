// Throwaway probe for 016-extensions/research/seams.md, question 1. Not product code.
// The smallest object `RunnerAdapter` accepts at HEAD: only its required members, for a
// runner that lists one test file, reads no graph and reports every check as one pass.
// It shows the type alone; nothing in the daemon can load it (seams.md, F1.3).
import type {
  AffectedTestFiles,
  EnumeratedCheck,
  InvalidateResult,
  RunnerAdapter,
  RunnerClosure,
  RunnerEnvironment,
  RunReport,
  TestFileRef,
} from "../../../../../../src/core/types/index.js";

const file = { project: "toy", path: "toy.check" } as TestFileRef;

export const toy: RunnerAdapter = {
  name: "toy",
  adapterVersion: "1",
  async invalidate(): Promise<InvalidateResult> {
    return { recreatedProjects: [] };
  },
  async affected(): Promise<AffectedTestFiles> {
    return { direct: [file], transitive: [] };
  },
  async closure(testFile): Promise<RunnerClosure> {
    return { testFile, paths: [testFile.path] };
  },
  async enumerate(): Promise<readonly EnumeratedCheck[]> {
    return [];
  },
  async testFiles() {
    return [file];
  },
  async environment(): Promise<readonly RunnerEnvironment[]> {
    return [
      {
        project: file.project,
        runnerName: "toy",
        runnerVersion: "0",
        adapterVersion: "1",
        resolvedConfig: "{}",
        files: [],
      },
    ];
  },
  async run(testFiles): Promise<RunReport> {
    return {
      end: "completed",
      durationMs: 0,
      completedFiles: testFiles,
      results: testFiles.map((t) => ({
        check: { kind: "test", project: t.project, testPath: t.path, fullName: "whole file" },
        outcome: "pass",
        durationMs: 0,
        location: null,
        errors: [],
      })),
      fileErrors: [],
      failure: null,
    };
  },
  async close() {},
};
