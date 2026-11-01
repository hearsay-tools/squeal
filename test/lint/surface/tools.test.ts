import { describe, expect, it } from "vitest";
import { lintFingerprint } from "../../../src/core/lint/fingerprint.js";
import type { LintTransitionRecord } from "../../../src/core/lint/store/types.js";
import { candidatesOf, planLintNews } from "../../../src/core/lint/surface/news.js";
import {
  type LintToldMark,
  lintCheckName,
  lintCheckOf,
  NO_MARK,
  readTold,
  toldKey,
  writeTold,
} from "../../../src/core/lint/surface/told.js";
import type {
  LintCheckId,
  LintFinding,
  LintKnownState,
  LintTool,
} from "../../../src/core/types/lint.js";
import { finding } from "../helpers.js";

/* Spec 017 D11: a path with a check per tool is two checks in a delivery, never one. */

const ME = { worktreeId: "w1", sessionId: "s1", agentId: "main" };
const check = (tool: LintTool, path = "src/a.ts"): LintCheckId => ({ kind: "lint", path, tool });

function failing(c: LintCheckId, findings: readonly LintFinding[]): LintKnownState {
  const fingerprint = lintFingerprint(findings);
  return {
    worktreeId: "w1",
    check: c,
    outcome: "fail",
    judged: { key: `k-${c.tool}`, outcome: "fail", fingerprint, blob: "b1", revision: 2 },
    stale: false,
    reason: null,
    changedAt: 2,
  };
}

function firstSeen(id: number, c: LintCheckId, added: LintFinding[]): LintTransitionRecord {
  return {
    id,
    worktreeId: "w1",
    check: c,
    kind: "first-seen-fail",
    added,
    removed: [],
    revision: 2,
    at: 1_000,
  };
}

function metaRepo() {
  const map = new Map<string, string>();
  return {
    map,
    get: (key: string) => map.get(key) ?? null,
    set: (key: string, value: string) => void map.set(key, value),
    delete: (key: string) => void map.delete(key),
  };
}

describe("a check per tool in one delivery (017 D11)", () => {
  const eslintFinding = [finding("no-undef", "x is not defined")];
  const oxlintFinding = [
    finding("eslint(no-unused-vars)", "Variable 'y' is declared but never used."),
  ];
  const eslint = failing(check("eslint"), eslintFinding);
  const oxlint = failing(check("oxlint"), oxlintFinding);
  const transitions = [
    firstSeen(1, check("eslint"), eslintFinding),
    firstSeen(2, check("oxlint"), oxlintFinding),
  ];

  it("tells each tool's change on one path, the oxlint one with its tool, and writes two view entries", () => {
    const plan = planLintNews({
      view: new Map(),
      states: new Map([eslint, oxlint].map((s) => [lintCheckName(s.check), s])),
      transitions,
      keyedAfter: 0,
      mark: NO_MARK,
      seenUpTo: null,
      findings: (s) => (s.check.tool === "eslint" ? eslintFinding : oxlintFinding),
      at: 2_000,
    });
    expect(plan.entries.map((e) => [e.path, e.tool, e.kind, e.added[0]?.rule])).toEqual([
      ["src/a.ts", undefined, "first-seen-fail", "no-undef"],
      ["src/a.ts", "oxlint", "first-seen-fail", "eslint(no-unused-vars)"],
    ]);
    // ESLint's entry has no `tool` key at all: its JSON is the release before's.
    expect(Object.keys(plan.entries[0] ?? {})).not.toContain("tool");
    expect(plan.writes.map((w) => w.check)).toEqual([check("eslint"), check("oxlint")]);
  });

  it("defers each tool's check apart while it is pending", () => {
    const pending = { ...oxlint, outcome: "pending" as const };
    const plan = planLintNews({
      view: new Map(),
      states: new Map([eslint, pending].map((s) => [lintCheckName(s.check), s])),
      transitions,
      keyedAfter: 0,
      mark: NO_MARK,
      seenUpTo: null,
      findings: () => eslintFinding,
      at: 2_000,
    });
    expect(plan.entries.map((e) => e.tool ?? "eslint")).toEqual(["eslint"]);
    expect(plan.deferred).toEqual([[lintCheckName(check("oxlint")), 0]]);
    // The next delivery looks at the deferred oxlint check, and not at ESLint's, told.
    const mark: LintToldMark = { ...NO_MARK, transition: 2, deferred: plan.deferred };
    expect(candidatesOf(mark, transitions).map(lintCheckOf)).toEqual([check("oxlint")]);
  });

  it("stores ESLint's deferred checks as before and another tool's with its tool", () => {
    const meta = metaRepo();
    const eslintOnly: LintToldMark = { ...NO_MARK, transition: 3, deferred: [["src/a.ts", 1]] };
    writeTold(meta, ME, eslintOnly);
    expect(meta.map.get(toldKey(ME))).toBe(JSON.stringify(eslintOnly));

    const both: LintToldMark = {
      ...NO_MARK,
      transition: 4,
      deferred: [
        [lintCheckName(check("eslint")), 1],
        [lintCheckName(check("oxlint")), 2],
      ],
    };
    writeTold(meta, ME, both);
    expect(JSON.parse(meta.map.get(toldKey(ME)) ?? "").deferred).toEqual([
      ["src/a.ts", 1],
      ["src/a.ts", 2, "oxlint"],
    ]);
    expect(readTold(meta, ME)).toEqual(both);
  });
});
