import type { TestCheckId } from "../../../../../src/core/types/check.js";
import type { TestFileRef } from "../../../../../src/core/types/keys.js";
import type { RunReport } from "../../../../../src/core/types/runner.js";
import type { Case } from "../../case.js";

/*
 * Spec 018 D3 and D4: `squeal import` stores a pass under its exported key
 * with the import's mark (`import:<id>`) as its provenance worktree. A
 * receiver that looks it up takes it as it takes another worktree's pass,
 * and applied again on its daemon's next pass, the state stands as it
 * stood. A release before 018 reads the mark as another worktree's id.
 */

const testFile: TestFileRef = { project: "", path: "test/a.test.ts" };
const check: TestCheckId = { kind: "test", project: "", testPath: testFile.path, fullName: "adds" };
const passed: Partial<RunReport> = {
  results: [{ check, outcome: "pass", durationMs: 3, location: null, errors: [] }],
};

export const IMPORTED: readonly Case[] = [
  {
    kind: "accept",
    name: "an imported pass, applied twice in the receiver",
    why: "018 D4: an imported pass stands at its key, and stays current when applied again",
    input: {
      testFile,
      runs: [{ worktree: "import:0123abcd", report: passed, recordedAt: 1_000 }],
      receiver: "B",
      reapplied: true,
    },
  },
];
