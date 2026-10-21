import type { RunReport, TestCheckId, TestFileRef } from "../../../../../src/core/types/index.js";
import type { Case } from "../../case.js";

/*
 * A timeout or crash in worktree B after it took A's pass (011-59): B's
 * checks become unknown with the tree's own code, nothing is stored under
 * the key, and the lookup still finds A's pass.
 */

const testFile: TestFileRef = { project: "", path: "test/a.test.ts" };
const check: TestCheckId = { kind: "test", project: "", testPath: testFile.path, fullName: "adds" };
const passed: Partial<RunReport> = {
  results: [{ check, outcome: "pass", durationMs: 3, location: null, errors: [] }],
};

export const UNKNOWN_AFTER: readonly Case[] = [
  {
    kind: "accept",
    name: "another worktree's pass, then a timeout here",
    why: "011-59 (gh-66): a timeout after an inherited pass is the receiver's own, stored under no key",
    input: {
      testFile,
      runs: [{ worktree: "A", report: passed, recordedAt: 1_000 }],
      receiver: "B",
      unknown: "timed out after 2 s",
    },
  },
];
