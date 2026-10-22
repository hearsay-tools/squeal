import type {
  CheckError,
  RunReport,
  TestCheckId,
  TestFileRef,
} from "../../../../../src/core/types/index.js";
import type { Case } from "../../case.js";

/*
 * A heal (spec 001 D6 as amended, task 001-170): worktree A's pass replaces
 * the fail stored at a key, and every other worktree at that key takes it as
 * `FAIL -> PASS` (`storeResults`). Review 0.1.266, B1 put the scheduler's
 * filter before the heal; a worktree it accepts heals as before. The merge
 * hold that refuses one is scheduler policy, off this path (011 C9). The
 * held fail stays out of these outputs: under D1 (a) an overlay on it cannot
 * fail an `accept` case (`reach.test.ts`).
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

export const HEAL: readonly Case[] = [
  {
    kind: "accept",
    name: "another worktree's pass heals this worktree's own fail",
    why: "001-170: a pass that replaces a fail at a key is current at once in every worktree at the key",
    input: {
      testFile,
      runs: [
        { worktree: "B", report: failed, recordedAt: 1_000 },
        { worktree: "A", report: passed, recordedAt: 1_500 },
      ],
      receiver: "B",
      heal: true,
    },
  },
];
