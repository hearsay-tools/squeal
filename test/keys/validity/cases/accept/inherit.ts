import type {
  CheckError,
  RunReport,
  TestCheckId,
  TestFileRef,
} from "../../../../../src/core/types/index.js";
import type { AcceptInput, Case } from "../../case.js";

/*
 * Another worktree's rows under one key, looked up in worktree B (D6): a pass
 * stands, an unconfirmed fail is held (001-170), a miss may wait on a claim
 * (001-205).
 */

const testFile: TestFileRef = { project: "", path: "test/a.test.ts" };
const check: TestCheckId = { kind: "test", project: "", testPath: testFile.path, fullName: "adds" };
const error: CheckError = {
  name: "AssertionError",
  message: "expected 3 to be 4",
  stack: null,
  location: { path: testFile.path, line: 4, column: 7 },
  diff: null,
};
const passed: Partial<RunReport> = {
  results: [{ check, outcome: "pass", durationMs: 3, location: null, errors: [] }],
};
const failed: Partial<RunReport> = {
  results: [{ check, outcome: "fail", durationMs: 3, location: error.location, errors: [error] }],
};

const accept = (name: string, why: string, input: Omit<AcceptInput, "testFile">): Case => ({
  kind: "accept",
  name,
  why,
  input: { testFile, ...input },
});

export const INHERIT: readonly Case[] = [
  accept("another worktree's pass", "D6: another worktree's pass stands at once", {
    runs: [{ worktree: "A", report: passed, recordedAt: 1_000 }],
    receiver: "B",
  }),
  accept("another worktree's unconfirmed fail", "001-170: held until a run here confirms it", {
    runs: [{ worktree: "A", report: failed, recordedAt: 1_000 }],
    receiver: "B",
  }),
  accept(
    "a fail this worktree confirmed",
    "001-170: a fail stands once this worktree's own state holds a fail under the key",
    {
      runs: [
        { worktree: "B", report: failed, recordedAt: 1_000 },
        { worktree: "A", report: failed, recordedAt: 1_500 },
      ],
      receiver: "B",
    },
  ),
  accept("this worktree's own fail", "D6: a worktree reuses its own results under their key", {
    runs: [{ worktree: "B", report: failed, recordedAt: 1_000 }],
    receiver: "B",
  }),
  accept(
    "another worktree's pass at a format read as one",
    "011-38: a miss copies the newest set stored at a format read as one to the key, and it stands as stored",
    {
      runs: [{ worktree: "A", report: passed, recordedAt: 1_000 }],
      receiver: "B",
      readAsOne: true,
    },
  ),
  accept("a miss", "001-205: a miss may wait on another worktree's claim", {
    runs: [],
    receiver: "B",
  }),
];
