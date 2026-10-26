import { describe, expect, it } from "vitest";
import { formatLintChanged, formatLintDetails } from "../../../src/cli/lint-report.js";
import { lintStatusLines } from "../../../src/core/status/lint-status.js";
import type {
  LintChangedEntry,
  LintDetails,
  LintFileDetail,
  LintStatus,
} from "../../../src/core/types/lint-delivery.js";
import { finding } from "../helpers.js";

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
  reasons: [],
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
      reasons: [
        { reason: "the ESLint worker timed out.", files: 3 },
        { reason: "eslint.config.js does not load: x\nstack", files: 1 },
        { reason: "the ESLint worker exited", files: 1 },
      ],
    };
    expect(lintStatusLines(lint, "squeal")).toEqual([
      "Lint: 12 files with findings, 3 pending; 5 files unknown: the ESLint worker timed out; eslint.config.js does not load: x; and 1 other reason; squeal lint lists them.",
    ]);
  });

  it("says why lint is off or unreadable, the first pass's progress, or nothing linted yet", () => {
    expect(lintStatusLines({ ...COUNTS, off: "ESLint 8 is not supported" }, "squeal")).toEqual([
      "Lint: off: ESLint 8 is not supported.",
    ]);
    expect(lintStatusLines({ ...COUNTS, unreadable: "the file is damaged (x)" }, "sq")).toEqual([
      "Lint: the lint store cannot be read: the file is damaged (x).",
    ]);
    expect(lintStatusLines({ ...COUNTS, linting: { done: 340, total: 600 } }, "squeal")).toEqual([
      "Lint: linting, 340 of 600 files.",
    ]);
    expect(lintStatusLines({ ...COUNTS, files: 0, failing: 0 }, "squeal")).toEqual([
      "Lint: no file linted yet.",
    ]);
    expect(lintStatusLines(undefined, "squeal")).toEqual([]);
  });

  it("adds a failed keying's reason under the counts (D9)", () => {
    const failed = "eslint.config.js does not load: SyntaxError";
    expect(lintStatusLines({ ...COUNTS, stale: 0, failed }, "squeal")).toEqual([
      "Lint: 12 files with findings, 2 since this session started; squeal lint lists them.",
      "Lint: unknown: eslint.config.js does not load: SyntaxError.",
    ]);
  });
});

const UNUSED = finding("no-unused-vars", "'count' is assigned a value but never used.", 3);
const PARSE = { ...finding(null, "Parsing error: x\ny", 9), severity: "warning" as const };

function file(path: string, fields: Partial<LintFileDetail> = {}): LintFileDetail {
  return {
    path,
    outcome: "fail",
    stale: false,
    reason: null,
    revision: 6,
    findings: [{ ...UNUSED, column: 7 }, PARSE],
    ...fields,
  };
}

const DETAILS: LintDetails = {
  v: 1,
  files: [],
  notLinted: [],
  pending: 0,
  stale: 0,
  unknown: 0,
};

describe("squeal lint's details (017 D8)", () => {
  it("lists each file with findings, each finding with its place, severity, rule and message", () => {
    const text = formatLintDetails(
      {
        ...DETAILS,
        files: [
          file("src/a.ts"),
          file("src/b.ts", { stale: true, revision: 4, findings: [UNUSED] }),
          file("src/g.ts", { findings: null }),
        ],
        pending: 3,
        stale: 1,
        unknown: 1,
      },
      null,
    );
    expect(text).toBe(
      [
        "Lint: 3 files with findings",
        "  src/a.ts: 2 findings, linted at revision 6",
        "    3:7  error    no-unused-vars  'count' is assigned a value but never used.",
        "    9:1  warning  Parsing error: x",
        "  src/b.ts: 1 finding, linted at revision 4; stale: an input it reads changed, linted again when the agent is idle",
        "    3:1  error    no-unused-vars  'count' is assigned a value but never used.",
        "  src/g.ts: findings no longer stored, linted at revision 6",
        "Not current in this worktree: 3 pending, 1 stale, 1 unknown.",
        "",
      ].join("\n"),
    );
  });

  it("with paths, names files with no findings, files with no result and files not linted", () => {
    const text = formatLintDetails(
      {
        ...DETAILS,
        files: [
          file("src/a.ts", { outcome: "pass", findings: [] }),
          file("src/c.ts", { outcome: "pending", findings: [] }),
          file("src/d.ts", { outcome: "unknown", reason: "the ESLint worker timed out." }),
          file("src/e.ts", { outcome: "pending", revision: null, findings: null }),
        ],
        notLinted: ["README.md"],
        pending: 9,
      },
      ["src/a.ts", "src/c.ts", "src/d.ts", "src/e.ts", "README.md"],
    );
    expect(text).toBe(
      [
        "Lint: 0 files with findings in src/a.ts, src/c.ts, src/d.ts, src/e.ts, README.md",
        "  src/a.ts: no findings, linted at revision 6",
        "Not judged:",
        "  src/c.ts: pending: changed since revision 6, not linted yet",
        "  src/d.ts: unknown: the ESLint worker timed out",
        "  src/e.ts: pending: not linted yet",
        "Not linted (ESLint's config or the lint policy leaves them out):",
        "  README.md",
        "",
      ].join("\n"),
    );
  });

  it("leads with why lint cannot say more, and the first pass's progress", () => {
    const text = formatLintDetails(
      { ...DETAILS, off: "ESLint 8 is not supported", linting: { done: 2, total: 9 } },
      null,
    );
    expect(text).toBe(
      "Lint: off: ESLint 8 is not supported.\nLint: 0 files with findings\nLinting, 2 of 9 files.\n",
    );
  });
});

function changed(path: string, fields: Partial<LintChangedEntry> = {}): LintChangedEntry {
  return {
    path,
    kind: "pass-to-fail",
    added: [UNUSED],
    removed: [],
    revision: 5,
    outcome: "fail",
    stale: false,
    findings: 1,
    reason: null,
    ...fields,
  };
}

describe("squeal lint --changed (017 D8)", () => {
  it("lists each change with its revision, and what the file is now when that differs", () => {
    const text = formatLintChanged({
      v: 1,
      since: "session",
      entries: [
        changed("src/a.ts"),
        changed("src/b.ts", { kind: "fail-to-pass", added: [], findings: 0, outcome: "pass" }),
        changed("src/c.ts", { outcome: "pending" }),
        changed("src/d.ts", { outcome: "unknown", reason: "the ESLint worker exited" }),
        changed("src/e.ts", { kind: "removed", added: [], outcome: null, findings: null }),
      ],
    });
    expect(text).toBe(
      [
        "Lint: 5 files changed since this session started",
        "  FAIL lint: src/a.ts: 1 finding, +1 no-unused-vars ('count' is assigned a value but never used.); at revision 5",
        "  PASS lint: src/b.ts: no findings; at revision 5",
        "  FAIL lint: src/c.ts: 1 finding, +1 no-unused-vars ('count' is assigned a value but never used.); at revision 5; now pending: changed since, not linted yet",
        "  FAIL lint: src/d.ts: 1 finding, +1 no-unused-vars ('count' is assigned a value but never used.); at revision 5; now unknown: the ESLint worker exited",
        "  RESOLVED lint: src/e.ts: no longer linted; at revision 5; now not linted",
        "",
      ].join("\n"),
    );
  });

  it("says when no session is registered", () => {
    expect(formatLintChanged({ v: 1, since: null, entries: [] })).toBe(
      "Lint: no session is registered in this worktree, so nothing changed since one started.\n",
    );
  });
});
