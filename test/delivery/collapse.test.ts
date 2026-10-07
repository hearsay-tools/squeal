import { describe, expect, it } from "vitest";
import { formatDelta, MESSAGE_CAP_CHARS } from "../../src/core/delivery/index.js";
import type {
  CheckId,
  Delta,
  DeltaEntry,
  RetiredEntry,
  StatusHeader,
  TransitionEntry,
} from "../../src/core/types/index.js";

/* Task 001-91, lessons defect 15: many recoveries collapse to one summary line. */

const consumer = { worktreeId: "wt-a", sessionId: "s1", agentId: "main" };

const header: StatusHeader = {
  revision: 12,
  counts: { current: 60, pending: 0, stale: 0, unknown: 0 },
  testFilesWithoutChecks: { pending: 0, unknown: 0 },
  fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
};

const check = (path: string, name: string): CheckId => ({
  kind: "test",
  project: "",
  testPath: path,
  fullName: name,
});

/** `n` checks spread over files `a`, `b`, `c` in proportion 3:2:1, at most. */
function checks(n: number, prefix: string): CheckId[] {
  return Array.from({ length: n }, (_, i) => {
    const file = i % 6 < 3 ? "a" : i % 6 < 5 ? "b" : "c";
    return check(`tests/${prefix}-${file}.test.ts`, `case ${i}`);
  });
}

function recovery(c: CheckId): TransitionEntry {
  return {
    check: c,
    kind: "fail-to-pass",
    from: "fail",
    to: "pass",
    validity: "current",
    observedAt: 12,
    origin: { kind: "own" },
    summary: null,
    location: null,
  };
}

function regression(c: CheckId): TransitionEntry {
  return {
    ...recovery(c),
    kind: "pass-to-fail",
    from: "pass",
    to: "fail",
    summary: "expected 401, received 500",
    location: { path: "src/auth.ts", line: 42, column: 7 },
    changesInClosure: ["src/auth.ts", "src/session.ts", "src/token.ts", "src/user.ts"],
  };
}

function retired(c: CheckId): RetiredEntry {
  return {
    check: c,
    kind: "fail-retired",
    from: "fail",
    to: null,
    fingerprint: null,
    observedAt: 12,
  };
}

function delta(entries: DeltaEntry[], stillFailing?: CheckId[]): Delta {
  return {
    schemaVersion: 1,
    consumer,
    header,
    label: "transitions",
    entries,
    ...(stillFailing === undefined ? {} : { stillFailing }),
  };
}

/** The message after the title and header lines. */
const body = (text: string) => text.split("\n").slice(3);

describe("recoveries above five collapse (task 001-91)", () => {
  it("lists four recoveries in full, as before", () => {
    const text = formatDelta(delta(checks(4, "r").map(recovery), checks(2, "f")));
    expect(text.match(/^PASS {2}tests\//gm)).toHaveLength(4);
    expect(text.match(/FAIL -> PASS/g)).toHaveLength(4);
    expect(text).not.toContain("still failing");
  });

  it("states 31 recoveries with 2 still failing as one summary plus the 2 names", () => {
    const failing = [check("tests/x.test.ts", "one"), check("tests/y.test.ts", "two")];
    const text = formatDelta(delta(checks(31, "r").map(recovery), failing));
    expect(body(text)).toEqual([
      "PASS  31 checks recovered (FAIL -> PASS)",
      "      still failing: 2",
      "      tests/x.test.ts > one",
      "      tests/y.test.ts > two",
    ]);
  });

  it("states 31 recoveries with 20 still failing as the summary plus the recovered list by file", () => {
    const text = formatDelta(delta(checks(31, "r").map(recovery), checks(20, "f")));
    expect(body(text)).toEqual([
      "PASS  31 checks recovered (FAIL -> PASS)",
      "      16 in tests/r-a.test.ts",
      "      10 in tests/r-b.test.ts",
      "      5 in tests/r-c.test.ts",
    ]);
  });

  it("compares the lists by the lines they take, a long list grouped by file", () => {
    const spread = Array.from({ length: 31 }, (_, i) => check(`tests/m${i % 14}.test.ts`, `${i}`));
    expect(body(formatDelta(delta(checks(31, "r").map(recovery), checks(7, "f"))))).toEqual([
      "PASS  31 checks recovered (FAIL -> PASS)",
      "      16 in tests/r-a.test.ts",
      "      10 in tests/r-b.test.ts",
      "      5 in tests/r-c.test.ts",
    ]);
    expect(body(formatDelta(delta(spread.map(recovery), checks(7, "f"))))).toEqual([
      "PASS  31 checks recovered (FAIL -> PASS)",
      "      still failing: 7",
      "      4 in tests/f-a.test.ts",
      "      2 in tests/f-b.test.ts",
      "      1 in tests/f-c.test.ts",
    ]);
  });

  it("says nothing still fails when nothing does", () => {
    const text = formatDelta(delta(checks(8, "r").map(recovery), []));
    expect(body(text)).toEqual([
      "PASS  8 checks recovered (FAIL -> PASS)",
      "      still failing: 0",
    ]);
  });

  it("shows the recovered list when what still fails is not known", () => {
    const text = formatDelta(delta(checks(6, "r").map(recovery)));
    expect(body(text)[0]).toBe("PASS  6 checks recovered (FAIL -> PASS)");
    expect(text).not.toContain("still failing");
    expect(text).toContain("      3 in tests/r-a.test.ts");
  });

  it("counts the files past ten", () => {
    const many = Array.from({ length: 14 }, (_, i) => check(`tests/m${i}.test.ts`, "x"));
    const lines = body(formatDelta(delta(many.map(recovery))));
    expect(lines).toHaveLength(12);
    expect(lines.at(-1)).toBe("      and 4 more test files (4 checks)");
  });

  it("lists new failures in full above the summary", () => {
    const failures = checks(3, "n").map(regression);
    const text = formatDelta(delta([...failures, ...checks(31, "r").map(recovery)], []));
    expect(text.match(/^FAIL {2}tests\//gm)).toHaveLength(3);
    expect(text.indexOf("FAIL  tests/")).toBeLessThan(text.indexOf("31 checks recovered"));
  });

  it("collapses retired checks the same way", () => {
    const failing = [check("tests/x.test.ts", "one")];
    const text = formatDelta(delta(checks(9, "gone").map(retired), failing));
    expect(body(text)).toEqual([
      "RESOLVED  9 checks no longer reported by the runner (FAIL -> RESOLVED)",
      "      still failing: 1",
      "      tests/x.test.ts > one",
    ]);
    expect(formatDelta(delta(checks(5, "gone").map(retired)))).toContain(
      "      FAIL -> no longer reported by the runner",
    );
  });

  it("stays under the cap with 40 failures and counts what is left out", () => {
    const failures = Array.from({ length: 40 }, (_, i) =>
      regression(check(`tests/f${i}.test.ts`, `case ${i} ${"x".repeat(200)}`)),
    );
    const text = formatDelta(delta([...failures, ...checks(31, "r").map(recovery)], []));
    expect(text.length).toBeLessThanOrEqual(MESSAGE_CAP_CHARS);
    expect(text).toMatch(/Not shown: \d+ more changed checks \(\d+ FAIL, 31 PASS\)/);
    expect(text.split("\n").at(-1)).toMatch(/^Full output: squeal why/);
  });
});
