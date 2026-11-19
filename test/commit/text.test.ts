import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type CommitLintToolCounts,
  type CommitReport,
  type CommitTestCounts,
  parseCommitReport,
} from "../../src/core/commit/report.js";
import { commitLine, commitReportText } from "../../src/core/commit/text.js";
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

  const oxlint = (counts: Partial<CommitLintToolCounts> = {}): CommitLintToolCounts => ({
    tool: "oxlint",
    files: 7,
    findings: 0,
    notDetermined: 0,
    running: 0,
    ...counts,
  });
  const withLint = (tools: CommitLintToolCounts[], notRun?: string): CommitReport => ({
    ...counted({ notDetermined: 1 }),
    lint: {
      findings: tools.reduce((n, t) => n + t.findings, 0),
      notDetermined: tools.reduce((n, t) => n + t.notDetermined, 0),
      running: tools.reduce((n, t) => n + t.running, 0),
      tools,
      ...(notRun === undefined ? {} : { notRun }),
    },
  });
  const tail = "; 1 test file not determined (unstaged changes)";
  /** The lint part of a report's line, as the skill quotes it. */
  const toolPartOf = (report: CommitReport) => commitReportText(report).split("; ")[1];

  // Row 017-32 (gh-170, gh-219, gh-237): the tool is the scope; the zero only on complete evidence.
  it.each([
    ["complete and clean", [oxlint()], "lint (oxlint): 0 findings in 7 of 7 files"],
    [
      "complete with findings",
      [oxlint({ findings: 3 })],
      "lint (oxlint): 3 findings in 7 of 7 files",
    ],
    ["one file", [oxlint({ files: 1, findings: 1 })], "lint (oxlint): 1 finding in 1 of 1 file"],
    [
      "running",
      [oxlint({ running: 4 })],
      "lint (oxlint): 4 of 7 files still running, 0 findings in the other 3",
    ],
    [
      "not determined",
      [oxlint({ notDetermined: 2, findings: 1 })],
      "lint (oxlint): 2 of 7 files not determined, 1 finding in the other 5",
    ],
    [
      "running and not determined",
      [oxlint({ running: 2, notDetermined: 1 })],
      "lint (oxlint): 2 of 7 files still running, 1 not determined, 0 findings in the other 4",
    ],
    ["none complete", [oxlint({ running: 7 })], "lint (oxlint): 7 of 7 files still running"],
    // Review 0.1.570 B1: files the pass has not listed lead; the zero never reads complete.
    [
      "not listed, the rest clean",
      [oxlint({ files: 1, unlisted: 1 })],
      "lint (oxlint): 1 changed file not listed yet, 0 findings in 1 of 1 listed file",
    ],
    [
      "not listed and running",
      [oxlint({ unlisted: 2, running: 3 })],
      "lint (oxlint): 2 changed files not listed yet, 3 of 7 listed files still running, 0 findings in the other 4",
    ],
    [
      "only not listed",
      [oxlint({ files: 0, unlisted: 3 })],
      "lint (oxlint): 3 changed files not listed yet",
    ],
    [
      "two tools",
      [{ ...oxlint({ findings: 2 }), tool: "eslint" }, oxlint({ running: 1 })],
      "lint (eslint): 2 findings in 7 of 7 files; lint (oxlint): 1 of 7 files still running, 0 findings in the other 6",
    ],
  ])("%s: %s", (_, tools, part) => {
    expect(commitReportText(withLint(tools))).toBe(
      `Commit abc1234: 0 known failures; ${part}${tail}`,
    );
  });

  it("says lint was not run, and why, when lint is on and no tool checked a changed file (017-32, gh-170)", () => {
    expect(commitReportText(withLint([], "off: oxlint is not installed"))).toBe(
      `Commit abc1234: 0 known failures; lint not run (off: oxlint is not installed)${tail}`,
    );
    expect(commitReportText(withLint([], "no changed file is linted"))).toBe(
      `Commit abc1234: 0 known failures; lint not run (no changed file is linted)${tail}`,
    );
  });

  it("never prints the bare `lint 0 findings` for a report with its tools (017-32, gh-219)", () => {
    for (const report of [withLint([oxlint()]), withLint([]), withLint([oxlint({ running: 7 })])]) {
      expect(commitReportText(report)).not.toMatch(/lint 0 findings/);
    }
  });

  it("is the line each copy of the skill's reports.md quotes (017-32)", () => {
    const example: CommitReport = {
      ...counted({ notDetermined: 1, running: 3 }),
      lint: { findings: 2, notDetermined: 0, running: 0, tools: [oxlint({ findings: 2 })] },
    };
    const running = toolPartOf(withLint([oxlint({ running: 4 })]));
    for (const plugin of ["claude-code", "codex-runtime", "pi"]) {
      const url = new URL(
        `../../plugins/${plugin}/skills/squeal/references/reports.md`,
        import.meta.url,
      );
      const text = readFileSync(url, "utf8");
      expect(text, plugin).toContain(`\`${commitReportText(example)}\``);
      expect(text, plugin).toContain(`\`${running}\``);
    }
  });

  it("keeps the line of a report stored before 017-32, and a stored report reads back as written", () => {
    const old: CommitReport = {
      ...counted({ notDetermined: 1 }),
      lint: { findings: 1, notDetermined: 1, running: 2 },
    };
    expect(commitReportText(old)).toBe(
      `Commit abc1234: 0 known failures; lint 1 finding, 1 file not determined, 2 files still running${tail}`,
    );
    for (const report of [old, withLint([oxlint({ running: 1 })]), withLint([], "off: x")]) {
      expect(parseCommitReport(JSON.parse(JSON.stringify(report)))).toEqual(report);
    }
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
