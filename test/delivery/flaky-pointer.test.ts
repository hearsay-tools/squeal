import { describe, expect, it } from "vitest";
import { formatDelta } from "../../src/core/delivery/index.js";
import { FLAKY_INPUTS_TEXT } from "../../src/core/state/index.js";
import type {
  Delta,
  DeltaEntry,
  FlakyNote,
  StatusHeader,
  TransitionEntry,
} from "../../src/core/types/index.js";

// Row 011-244 (gh-98): a flaky note reads "under the same tracked inputs", and a notice points to
// `inputs` in squeal.config.json once, right after the first note it names, however many notes
// and blocks it holds; a group of failures (row 011-109) is one place.

const header: StatusHeader = {
  revision: 12,
  counts: { current: 300, pending: 0, stale: 0, unknown: 0 },
  testFilesWithoutChecks: { pending: 0, unknown: 0 },
  fullSuite: { atCurrentRevision: false, lastCompletedRevision: 10 },
};

const notice = (entries: DeltaEntry[]) =>
  formatDelta({
    schemaVersion: 1,
    consumer: { worktreeId: "wt", sessionId: "s", agentId: "main" },
    header,
    label: "transitions",
    entries,
  } satisfies Delta);

const note = (from: FlakyNote["from"], to: FlakyNote["to"]): FlakyNote => ({
  key: "k",
  from,
  to,
  fromWorktreeId: "wt",
  toWorktreeId: "wt",
  at: 1,
});

function failure(path: string, name: string, flaky?: FlakyNote): TransitionEntry {
  return {
    check: { kind: "test", project: "", testPath: path, fullName: name },
    kind: "pass-to-fail",
    from: "pass",
    to: "fail",
    validity: "current",
    observedAt: 12,
    origin: { kind: "own" },
    summary: "ReferenceError: ResizeObserver is not defined",
    location: { path: "src/components/chart.tsx", line: 12, column: 5 },
    ...(flaky === undefined ? {} : { flaky }),
  };
}

function recovery(path: string, name: string, flaky?: FlakyNote): TransitionEntry {
  return {
    ...failure(path, name, flaky),
    kind: "fail-to-pass",
    from: "fail",
    to: "pass",
    summary: null,
  };
}

const POINTER = `      ${FLAKY_INPUTS_TEXT}`;
const FLIP = "      Flaky: PASS -> FAIL under the same tracked inputs";
const HEAL = "      Flaky: FAIL -> PASS under the same tracked inputs";

describe("a notice points to `inputs` once, after its first flaky note (row 011-244)", () => {
  it("puts it after a group's note, not after a single failure's or a recovery's", () => {
    const flip = note("pass", "fail");
    const lines = notice([
      failure("tests/a.test.ts", "one", flip),
      failure("tests/b.test.ts", "two", flip),
      { ...failure("tests/c.test.ts", "three", flip), summary: "Error: other" },
      recovery("tests/d.test.ts", "four", note("fail", "pass")),
    ]).split("\n");
    const group = lines.indexOf("FAIL  2 checks with one error and location (2 tests)");
    expect(group).toBeGreaterThan(0);
    expect(lines.filter((l) => l === FLIP)).toHaveLength(2);
    expect(lines.filter((l) => l === HEAL)).toHaveLength(1);
    expect(lines.filter((l) => l === POINTER)).toHaveLength(1);
    expect(lines.indexOf(FLIP)).toBeGreaterThan(group);
    expect(lines.indexOf(FLIP)).toBeLessThan(lines.indexOf("FAIL  tests/c.test.ts > three"));
    expect(lines[lines.indexOf(FLIP) + 1]).toBe(POINTER);
  });

  it("puts it after the first of several flaky recoveries only", () => {
    const heal = note("fail", "pass");
    const lines = notice([
      recovery("tests/a.test.ts", "one"),
      recovery("tests/b.test.ts", "two", heal),
      recovery("tests/c.test.ts", "three", heal),
    ]).split("\n");
    expect(lines.filter((l) => l === HEAL)).toHaveLength(2);
    expect(lines.filter((l) => l === POINTER)).toHaveLength(1);
    expect(lines.indexOf(HEAL)).toBeGreaterThan(lines.indexOf("PASS  tests/b.test.ts > two"));
    expect(lines[lines.indexOf(HEAL) + 1]).toBe(POINTER);
  });

  it("names no `inputs` in a notice without a flaky note", () => {
    const text = notice([failure("tests/a.test.ts", "one"), recovery("tests/b.test.ts", "two")]);
    expect(text).not.toContain("Flaky:");
    expect(text).not.toContain(FLAKY_INPUTS_TEXT);
  });
});
