import { describe, expect, it } from "vitest";
import {
  type CellRecord,
  conditionsOf,
  declarations,
  parserExpectationsOf,
  squealEvidence,
} from "../../evals/lib/index.mjs";
import { formatDelta } from "../../src/core/delivery/format.js";
import type { Delta, TransitionEntry } from "../../src/core/types/index.js";
import { denialSentence, knownFailuresLine } from "../../src/harness/shared/text.js";
import { CLAIM, type Harness, REGISTERED, session } from "./reference-sessions.js";

// Row 011-109: the evals parser reads a group of failures with one error and location as the real
// `formatDelta` words it, as a Codex session keeps it (plain text) and as Claude Code keeps a
// hook's JSON reply (a delivery's context, a deny's reason). Each check it names keeps its own
// provenance; a test file it counts is a failing file with that count.

const RESIZE = "ReferenceError: ResizeObserver is not defined";

function failure(
  path: string,
  name: string,
  revision: number,
  overrides: Partial<TransitionEntry> = {},
): TransitionEntry {
  return {
    check: { kind: "test", project: "", testPath: path, fullName: name },
    kind: "pass-to-fail",
    from: "pass",
    to: "fail",
    validity: "current",
    observedAt: revision,
    origin: { kind: "own" },
    summary: RESIZE,
    location: { path: "src/components/chart.tsx", line: 12, column: 5 },
    ...overrides,
  };
}

/** `count` failures at `revision` in `files` test files, `test/c<i>.test.ts`, the first the most. */
const spread = (count: number, files: number, revision: number) =>
  Array.from({ length: count }, (_, i) =>
    failure(`test/c${i % files}.test.ts`, `renders case ${i}`, revision),
  );

function delivered(entries: TransitionEntry[], revision: number, pending = 0): Delta {
  return {
    schemaVersion: 1,
    consumer: { worktreeId: "wt", sessionId: "s", agentId: "main" },
    header: {
      revision,
      counts: { current: 120 - pending, pending, stale: 0, unknown: 0 },
      testFilesWithoutChecks: { pending: 0, unknown: 0 },
      fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
    },
    label: "transitions",
    entries,
  };
}

const notice = (entries: TransitionEntry[], revision = 3, pending = 0) =>
  formatDelta(delivered(entries, revision, pending));

/** A Claude Code hook's reply carrying `text`: a delivery's context, or a deny's reason. */
const forms = (text: string): [string, string][] => [
  ["plain text", text],
  [
    "a hook's context",
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PostToolBatch", additionalContext: text },
    }),
  ],
  [
    "a deny's reason",
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `${text}\n\n${denialSentence("Edit")}`,
      },
    }),
  ],
];

const current = { to: "fail", from: "pass", observed: 3, validity: "current" };

/** The evidence a delivered `text` carries; a text with none fails the test. */
function read(text: string) {
  const step = squealEvidence(text, "push");
  if (step === null) throw new Error(`no evidence in: ${text}`);
  return { ...step, checks: step.checks ?? [] };
}

describe("the evals parser reads a grouped notice (row 011-109)", () => {
  const big = notice(spread(91, 7, 3));

  it("is the real block: 91 checks counted by test file, one command", () => {
    expect(big).toContain("FAIL  91 checks with one error and location (91 tests)\n");
    expect(big).toContain("      13 tests in test/c0.test.ts\n");
    expect(big).toContain(
      `      Full list: squeal failures test --error "${RESIZE}" --per-check --limit all\n`,
    );
  });

  for (const [form, text] of forms(big))
    it(`counts 91 failures in 7 failing test files, read from ${form}`, () => {
      const step = read(text);
      expect(step).toMatchObject({ revision: 3, failures: 91, verdict: "fail" });
      expect(step.checks).toEqual(
        Array.from({ length: 7 }, (_, i) => ({
          ...current,
          file: `test/c${i}.test.ts`,
          count: 13,
        })),
      );
      expect([...step.failing].sort()).toEqual(
        Array.from({ length: 7 }, (_, i) => `test/c${i}.test.ts`),
      );
    });

  for (const [form, text] of forms(
    notice([failure("test/a.test.ts", "one", 3), failure("test/b.test.ts", "two", 3)]),
  ))
    it(`names each check of a small group with its provenance, read from ${form}`, () => {
      const step = read(text);
      expect(step.checks).toEqual([
        { ...current, check: "test/a.test.ts > one", file: "test/a.test.ts" },
        { ...current, check: "test/b.test.ts > two", file: "test/b.test.ts" },
      ]);
      expect(step).toMatchObject({ failures: 2, failing: ["test/a.test.ts", "test/b.test.ts"] });
    });

  it("reads a group seen at an older revision, now pending, as not current", () => {
    const old = (path: string, name: string) =>
      failure(path, name, 2, { validity: "pending", observedAt: 2 });
    const text = notice([old("test/a.test.ts", "one"), old("test/b.test.ts", "two")], 3, 2);
    expect(text).toContain(
      "      PASS -> FAIL, seen by Squeal's run at revision 2, revision 3 pending\n",
    );
    const step = read(text);
    expect(step.checks.map((c) => ("validity" in c ? c.validity : null))).toEqual([
      "pending",
      "pending",
    ]);
    expect(step).toMatchObject({ failures: 2, failing: [] });
  });

  it("counts the test files past ten, a single failure and a second group apart", () => {
    const fetch = (i: number) =>
      failure(`test/api${i}.test.ts`, "posts", 3, {
        summary: "TypeError: fetch failed",
        location: { path: "src/api.ts", line: 3, column: 9 },
      });
    const text = notice([
      ...spread(30, 14, 3),
      failure("test/z.test.ts", "alone", 3, { summary: "expected 1 to be 2" }),
      fetch(0),
      fetch(1),
      fetch(2),
    ]);
    expect(text).toContain("      and 4 more test files (8 tests)\n");
    const step = read(text);
    expect(step.failures).toBe(34);
    const counted = step.checks.filter((c) => "count" in c);
    expect(counted.reduce((n, c) => n + ("count" in c ? c.count : 0), 0)).toBe(30);
    expect(counted.at(-1)).toEqual({ ...current, count: 8 });
    expect(step.checks.filter((c) => "check" in c)).toEqual([
      { ...current, check: "test/z.test.ts > alone", file: "test/z.test.ts" },
      { ...current, check: "test/api0.test.ts > posts", file: "test/api0.test.ts" },
      { ...current, check: "test/api1.test.ts > posts", file: "test/api1.test.ts" },
      { ...current, check: "test/api2.test.ts > posts", file: "test/api2.test.ts" },
    ]);
  });

  it("takes Stop's known-failures count and names no check it did not name", () => {
    const entries = spread(91, 7, 3);
    const delta = delivered(entries, 3);
    const stop = `${formatDelta(delta, "squeal", undefined, "full")}\n${knownFailuresLine(entries, "squeal", delta.header)}`;
    const step = read(stop);
    expect(step).toMatchObject({ known: 91, failures: 91, verdict: "fail" });
  });
});

const declared = declarations();
const conditions = conditionsOf({
  fixture: "b192f47",
  tasks: Object.fromEntries(
    Object.entries(declared.tasks).map(([t, knobs]) => [t, { prompt: t, knobs }]),
  ),
  variant: "p0",
  effort: "medium",
});
const grade = (c: CellRecord) => parserExpectationsOf(c, conditions, declared);

for (const harness of ["codex", "claude"] as const satisfies Harness[])
  describe(`a grouped notice at the claim (row 011-109), ${harness}`, () => {
    const hooked = (text: string) =>
      harness === "claude"
        ? JSON.stringify({
            hookSpecificOutput: { hookEventName: "PostToolBatch", additionalContext: text },
          })
        : text;
    const claimed = (text: string) =>
      grade(
        session(
          "t1-thousands",
          [
            { squeal: REGISTERED(0) },
            { edit: "src/money.ts" },
            { squeal: hooked(text) },
            CLAIM("fail"),
          ],
          { truthPass: false, status: "fail", harness },
        ),
      )?.["current-before-claim"];

    it("is current evidence for a fail claim at its revision", () => {
      expect(claimed(notice(spread(91, 7, 1), 1))).toBe("met");
    });

    it("is not, when its checks were seen at an older revision", () => {
      const old = spread(91, 7, 0).map((e) => ({ ...e, validity: "pending" as const }));
      expect(claimed(notice(old, 1, 91))).toBe("missed");
    });
  });
