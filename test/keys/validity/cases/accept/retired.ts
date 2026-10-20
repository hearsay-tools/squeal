import type { TestCheckId, TestFileRef } from "../../../../../src/core/types/index.js";
import type { Case } from "../../case.js";

/*
 * Spec 001 D8: checks that disappear from a test file are retired. A hit
 * another worktree stored becomes the receiver's results, and the checks
 * its current results held that the hit lacks are retired.
 */

const testFile: TestFileRef = { project: "", path: "test/a.test.ts" };
const test = (fullName: string): TestCheckId => ({
  kind: "test",
  project: "",
  testPath: testFile.path,
  fullName,
});

export const RETIRED: readonly Case[] = [
  {
    kind: "accept",
    name: "a hit that lacks a check the receiver held",
    why: "001 D8: the hit's checks become the file's, and a check it lacks is retired",
    input: {
      testFile,
      runs: [
        {
          worktree: "A",
          report: {
            results: [
              { check: test("adds"), outcome: "pass", durationMs: 3, location: null, errors: [] },
            ],
          },
          recordedAt: 1_000,
        },
      ],
      receiver: "B",
      current: [test("adds"), test("subtracts")],
    },
  },
];
