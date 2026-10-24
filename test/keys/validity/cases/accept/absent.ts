import type { TestCheckId, TestFileRef } from "../../../../../src/core/types/index.js";
import type { Case } from "../../case.js";

/*
 * Row 011-158 (011 C3): the file's closure names its snapshot path, which has
 * no file, as every Vitest closure does. The release keys it as `path\0-\0`,
 * the candidate leaves it out. Each tree stores a pass at its own key; the
 * candidate's lookup over the release's store finds the row through the
 * definition before 011-158, as over its own store at its key.
 */

const testFile: TestFileRef = { project: "", path: "test/a.test.ts" };
const check: TestCheckId = { kind: "test", project: "", testPath: testFile.path, fullName: "adds" };
const absent = ["test/__snapshots__/a.test.ts.snap"];

export const ABSENT: readonly Case[] = [
  {
    kind: "accept",
    name: "a pass stored at a closure that names a path with no file",
    why: "011-158: a row stored while absent paths entered the key is read as one",
    input: {
      testFile,
      installed: {},
      absent,
      runs: [
        {
          worktree: "A",
          report: {
            results: [{ check, outcome: "pass", durationMs: 3, location: null, errors: [] }],
          },
          recordedAt: 1_000,
        },
      ],
      receiver: "B",
    },
  },
];
