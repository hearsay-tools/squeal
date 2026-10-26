import { describe, expect, it } from "vitest";
import { formatLintReport, type LintReportFile } from "../../../src/cli/lint-report.js";
import { type LintStatus, lintStatusLines } from "../../../src/core/status/lint-status.js";

/* Spec 017 D8: status's lint line and `squeal lint`'s details. */

const COUNTS: LintStatus = {
  v: 1,
  files: 600,
  failing: 12,
  sinceRegistration: 2,
  since: "session",
  pending: 0,
  stale: 40,
  unknown: 0,
};

describe("status's lint line (017 D8)", () => {
  it("counts the files with findings, those since the session, and the stale", () => {
    expect(lintStatusLines(COUNTS, "squeal")).toEqual([
      "Lint: 12 files with findings, 2 since this session started, 40 stale; squeal lint lists them.",
    ]);
  });

  it("names pending files and why files are unknown, the most frequent reasons first", () => {
    const lint: LintStatus = {
      ...COUNTS,
      since: null,
      pending: 3,
      stale: 0,
      unknown: 5,
      unknownReasons: [
        { reason: "the ESLint worker timed out.", files: 3 },
        { reason: "eslint.config.js does not load: x\nstack", files: 1 },
        { reason: "the ESLint worker exited", files: 1 },
      ],
    };
    expect(lintStatusLines(lint, "squeal")).toEqual([
      "Lint: 12 files with findings, 3 pending; 5 files unknown: the ESLint worker timed out; eslint.config.js does not load: x; and 1 other reason; squeal lint lists them.",
    ]);
  });

  it("says why lint is off, the first pass's progress, or that nothing is linted yet", () => {
    expect(lintStatusLines({ ...COUNTS, off: "ESLint 8 is not supported" }, "squeal")).toEqual([
      "Lint: off: ESLint 8 is not supported.",
    ]);
    expect(lintStatusLines({ ...COUNTS, linting: { done: 340, total: 600 } }, "squeal")).toEqual([
      "Lint: linting, 340 of 600 files.",
    ]);
    expect(lintStatusLines({ ...COUNTS, files: 0, failing: 0 }, "squeal")).toEqual([
      "Lint: no file linted yet.",
    ]);
    expect(lintStatusLines(undefined, "squeal")).toEqual([]);
  });
});

function file(path: string, fields: Partial<LintReportFile> = {}): LintReportFile {
  return {
    path,
    outcome: "fail",
    stale: false,
    reason: null,
    changedAt: 5,
    lintedAt: 6,
    findings: [
      {
        rule: "no-unused-vars",
        message: "'count' is assigned a value but never used.",
        severity: "error",
        line: 3,
        column: 7,
      },
      { rule: null, message: "Parsing error: x\ny", severity: "warning", line: 9, column: 1 },
    ],
    ...fields,
  };
}

describe("squeal lint's details (017 D8)", () => {
  it("lists each file with findings, each finding with its place, severity, rule and message", () => {
    const text = formatLintReport({
      v: 1,
      available: true,
      paths: null,
      files: [
        file("src/a.ts"),
        file("src/b.ts", { stale: true, changedAt: 4, findings: file("").findings.slice(0, 1) }),
        file("src/c.ts", { outcome: "pending", findings: [] }),
        file("src/d.ts", {
          outcome: "unknown",
          reason: "the ESLint worker timed out",
          findings: [],
        }),
        file("src/e.ts", { outcome: "pending", lintedAt: null, findings: [] }),
      ],
    });
    expect(text).toBe(
      [
        "Lint: 2 files with findings",
        "  src/a.ts: 2 findings, since revision 5",
        "    3:7  error    no-unused-vars  'count' is assigned a value but never used.",
        "    9:1  warning  Parsing error: x",
        "  src/b.ts: 1 finding, since revision 4; stale: an input it reads changed, re-linted when the agent is idle",
        "    3:7  error    no-unused-vars  'count' is assigned a value but never used.",
        "Not judged:",
        "  src/c.ts: pending: changed since revision 6, not linted yet",
        "  src/d.ts: unknown: the ESLint worker timed out",
        "  src/e.ts: pending: not linted yet",
        "",
      ].join("\n"),
    );
  });

  it("with paths, names a file with no findings too, and with --changed whose registration", () => {
    const pass = file("src/a.ts", { outcome: "pass", findings: [] });
    expect(formatLintReport({ v: 1, available: true, paths: ["src/a.ts"], files: [pass] })).toBe(
      "Lint: 0 files with findings in src/a.ts\n  src/a.ts: no findings, linted at revision 6\n",
    );
    expect(
      formatLintReport({
        v: 1,
        available: true,
        paths: null,
        changedSince: { revision: 3, scope: "session" },
        files: [pass, file("src/b.ts")],
      }).split("\n")[1],
    ).toBe("Changed since revision 3, when this session registered.");
    expect(
      formatLintReport({ v: 1, available: true, paths: null, changedSince: null, files: [] }),
    ).toBe(
      "Lint: 0 files changed, 0 with findings\nNo session is registered in this worktree, so nothing changed since one started.\n",
    );
  });
});
