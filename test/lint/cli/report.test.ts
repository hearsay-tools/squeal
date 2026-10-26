import { describe, expect, it } from "vitest";
import { CHANGED_ON_DISK, GONE_FROM_DISK } from "../../../src/cli/lint-disk.js";
import { formatLintChanged, formatLintDetails } from "../../../src/cli/lint-report.js";
import type {
  LintChangedEntry,
  LintDetails,
  LintFileDetail,
} from "../../../src/core/types/lint-delivery.js";
import { finding } from "../helpers.js";

/* Spec 017 D8: how `squeal lint` prints its details and its changes. */

const UNUSED = finding("no-unused-vars", "'count' is assigned a value but never used.", 3);
const PARSE = { ...finding(null, "Parsing error: x\ny", 9), severity: "warning" as const };

function file(path: string, fields: Partial<LintFileDetail> = {}): LintFileDetail {
  return {
    path,
    outcome: "fail",
    stale: false,
    reason: null,
    revision: 6,
    blob: "b".repeat(40),
    findings: [{ ...UNUSED, column: 7 }, PARSE],
    ...fields,
  };
}

const DETAILS: LintDetails = {
  v: 1,
  files: [],
  notLinted: [],
  waiting: [],
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
        "  src/b.ts: 1 finding, linted at revision 4 (an input changed since it was linted; linting resumes when the agent is idle)",
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

  it("says a result its bytes on disk moved past is pending, with the revision and findings it had", () => {
    const text = formatLintDetails(
      {
        ...DETAILS,
        files: [
          file("src/a.ts", { outcome: "pending", reason: CHANGED_ON_DISK }),
          file("src/b.ts", { outcome: "pending", reason: GONE_FROM_DISK, findings: [] }),
          file("src/c.ts", { outcome: "unknown", reason: "Squeal could not read it: EACCES" }),
        ],
        waiting: ["lib"],
      },
      ["src", "lib"],
    );
    expect(text).toBe(
      [
        "Lint: 0 files with findings in src, lib",
        "Not judged:",
        "  src/a.ts: pending: changed on disk since its lint at revision 6 (2 findings then)",
        "  src/b.ts: pending: no longer a file on disk since its lint at revision 6 (no findings then)",
        "  src/c.ts: unknown: Squeal could not read it: EACCES",
        "Not known yet (the first lint in this worktree has not finished):",
        "  lib",
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
    blob: "b".repeat(40),
    judgedAt: 5,
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
        changed("src/f.ts", { outcome: "pending", reason: CHANGED_ON_DISK }),
        changed("src/e.ts", { kind: "removed", added: [], outcome: null, findings: null }),
      ],
    });
    expect(text).toBe(
      [
        "Lint: 6 files changed since this session started",
        "  FAIL lint: src/a.ts: 1 finding, +1 no-unused-vars ('count' is assigned a value but never used.); at revision 5",
        "  PASS lint: src/b.ts: no findings; at revision 5",
        "  FAIL lint: src/c.ts: 1 finding, +1 no-unused-vars ('count' is assigned a value but never used.); at revision 5; now pending: changed since, not linted yet",
        "  FAIL lint: src/d.ts: 1 finding, +1 no-unused-vars ('count' is assigned a value but never used.); at revision 5; now unknown: the ESLint worker exited",
        "  FAIL lint: src/f.ts: 1 finding, +1 no-unused-vars ('count' is assigned a value but never used.); at revision 5; now pending: changed on disk since its lint",
        "  RESOLVED lint: src/e.ts: deleted or no longer linted; at revision 5; now not linted",
        "",
      ].join("\n"),
    );
  });

  it("tells a change whose result is no longer the file's as history, then the state now", () => {
    const text = formatLintChanged({
      v: 1,
      since: "session",
      entries: [
        changed("src/a.ts", { findings: 2, stale: true, judgedAt: 7 }),
        changed("src/b.ts", {
          kind: "fail-changed",
          removed: [PARSE],
          findings: 0,
          outcome: "pass",
          judgedAt: 7,
        }),
        changed("src/c.ts", { outcome: "pending", findings: 0, judgedAt: 7 }),
        changed("src/d.ts", {
          kind: "fail-to-pass",
          added: [],
          outcome: "pass",
          findings: 0,
          stale: true,
        }),
        changed("src/e.ts", { kind: "removed", added: [], judgedAt: 7, findings: null }),
      ],
    });
    expect(text).toBe(
      [
        "Lint: 5 files changed since this session started",
        "  FAIL lint: src/a.ts: 1 finding, +1 no-unused-vars ('count' is assigned a value but never used.); at revision 5; now fail: 2 findings, linted at revision 7 (an input changed since it was linted; linting resumes when the agent is idle)",
        "  FAIL lint: src/b.ts: findings not stored, +1 no-unused-vars, -1 Parsing error: x; at revision 5; now pass: no findings, linted at revision 7",
        "  FAIL lint: src/c.ts: 1 finding, +1 no-unused-vars ('count' is assigned a value but never used.); at revision 5; now pending: changed since revision 7, not linted yet",
        "  PASS lint: src/d.ts: no findings; at revision 5; now stale (an input changed since it was linted; linting resumes when the agent is idle)",
        "  RESOLVED lint: src/e.ts: deleted or no longer linted; at revision 5; now fail: findings no longer stored, linted at revision 7",
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
