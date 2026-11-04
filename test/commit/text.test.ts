import { describe, expect, it } from "vitest";
import {
  type CommitReport,
  type CommitTestCounts,
  commitLine,
  commitReportText,
  parseCommitReport,
} from "../../src/core/commit/index.js";
import { commitLines } from "../../src/core/status/commit-lines.js";

/*
 * Row 019-13 (spec 019 D5 step 3): the report's one line is a pure function
 * of the stored report, which 019-16 delivers and shows in status.
 */

const SHA = "abc1234def5678abc1234def5678abc1234def56";
const NONE: CommitTestCounts = { files: 4, failures: 0, notDetermined: 0, running: 0, unknown: 0 };
const counted = (tests: Partial<CommitTestCounts>, lint?: CommitReport & object): CommitReport => ({
  commit: SHA,
  revision: 3,
  at: 1,
  tests: { ...NONE, ...tests },
  ...(lint ?? {}),
});

describe("commitReportText (019-13)", () => {
  it.each([
    [counted({}), "Commit abc1234: 0 known failures"],
    [counted({ failures: 1 }), "Commit abc1234: 1 known failure"],
    [
      counted({ notDetermined: 1, running: 3 }),
      "Commit abc1234: 0 known failures; 1 test file not determined (unstaged changes); 3 test files still running",
    ],
    [
      counted({ failures: 2, notDetermined: 2, running: 1, unknown: 5 }),
      "Commit abc1234: 2 known failures; 2 test files not determined (unstaged changes); 1 test file still running; 5 test files unknown",
    ],
    // Row 019-28 (P4): "(unstaged changes)" only for files staged differently.
    [
      counted({ notDetermined: 3, untracked: 1 }),
      "Commit abc1234: 0 known failures; 2 test files not determined (unstaged changes); 1 test file not determined (untracked files)",
    ],
    [
      counted({ notDetermined: 2, untracked: 2 }),
      "Commit abc1234: 0 known failures; 2 test files not determined (untracked files)",
    ],
    // Row 019-39 (review 0.1.402 B2): a file git did not answer for is no unstaged change.
    [
      counted({ notDetermined: 1, unanswered: 1 }),
      "Commit abc1234: 0 known failures; 1 test file not determined (git did not answer)",
    ],
    [
      counted({ notDetermined: 4, untracked: 1, unanswered: 2 }),
      "Commit abc1234: 0 known failures; 1 test file not determined (unstaged changes); 1 test file not determined (untracked files); 2 test files not determined (git did not answer)",
    ],
  ])("%#: names each count that is not zero, known failures always", (report, text) => {
    expect(commitReportText(report)).toBe(text);
  });

  it("puts lint after known failures while its counts were read", () => {
    const report: CommitReport = {
      commit: SHA,
      revision: 3,
      at: 1,
      tests: { ...NONE, notDetermined: 1 },
      lint: { findings: 2, notDetermined: 0, running: 0 },
    };
    expect(commitReportText(report)).toBe(
      "Commit abc1234: 0 known failures; lint 2 findings; 1 test file not determined (unstaged changes)",
    );
    const more = { ...report, lint: { findings: 1, notDetermined: 1, running: 2 } };
    expect(commitReportText(more)).toBe(
      "Commit abc1234: 0 known failures; lint 1 finding, 1 file not determined, 2 files still running; 1 test file not determined (unstaged changes)",
    );
  });

  it("`status --full` tells the paths git did not answer for from those that differ (019-39, review 0.1.402 B2)", () => {
    const file = (path: string, through: string[], more?: number) => ({
      project: "",
      path,
      through,
      ...(more === undefined ? {} : { more }),
    });
    const report = counted({
      notDetermined: 3,
      unanswered: 2,
      notDeterminedFiles: [
        { ...file("test/a.test.ts", ["src/a.ts"]), unanswered: ["src/a.ts"] },
        { ...file("test/b.test.ts", ["src/b.ts", "src/a.ts"]), unanswered: ["src/a.ts"] },
        { ...file("test/c.test.ts", ["src/a.ts", "src/c.ts"], 2), unanswered: ["src/a.ts"] },
      ],
    });
    expect(commitLines(commitLine(report), true)).toEqual([
      "Commit abc1234: 0 known failures; 1 test file not determined (unstaged changes); 2 test files not determined (git did not answer)",
      "  test/a.test.ts is not determined: git did not answer for src/a.ts",
      "  test/b.test.ts is not determined: src/b.ts differs from the commit; git did not answer for src/a.ts",
      "  test/c.test.ts is not determined: src/c.ts differs from the commit; git did not answer for src/a.ts; 2 more paths not shown",
    ]);
    // A stored report keeps both, as written.
    expect(parseCommitReport(JSON.parse(JSON.stringify(report)))).toEqual(report);
  });

  it("says why a report could not be made", () => {
    const report: CommitReport = { commit: SHA, revision: 3, at: 1, failed: "git ls-tree failed" };
    expect(commitReportText(report)).toBe("Commit abc1234: no report (git ls-tree failed)");
  });
});
