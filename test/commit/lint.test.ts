import { describe, expect, it } from "vitest";
import { type LintView, lintCounts, readLintCounts } from "../../src/core/commit/lint.js";
import { lintScope, writeProgram } from "../../src/core/lint/pass/records.js";
import type { LintKnownState } from "../../src/core/types/lint.js";
import { check, commonDir, finding, LINT_ON, open } from "../lint/helpers.js";

/*
 * Row 019-13 slice 2 (spec 019 D5 step 2): lint checks in a commit's report,
 * file-local only. A check counts when it is judged, not stale and not
 * `unknown`, at the committed blob of its file; a whole-program check
 * counts only while nothing differs between the commit and the working tree.
 */

const W = "w1";

function state(
  path: string,
  outcome: LintKnownState["outcome"],
  overrides: Partial<LintKnownState> = {},
  blob = `blob-${path}`,
): LintKnownState {
  const judged = {
    key: `key-${path}`,
    outcome: outcome === "pass" ? ("pass" as const) : ("fail" as const),
    fingerprint: null,
    blob,
    revision: 1,
  };
  return {
    worktreeId: W,
    check: check(path),
    outcome,
    judged: outcome === "unknown" ? null : judged,
    stale: false,
    reason: null,
    changedAt: 1,
    ...overrides,
  };
}

const view = (
  states: readonly LintKnownState[],
  whole: readonly string[] = [],
  findings: Record<string, number | null> = {},
): LintView => ({
  states,
  wholeProgram: (s) => whole.includes(s.check.path),
  findings: (s) => (s.check.path in findings ? (findings[s.check.path] ?? null) : 1),
});

const committedOf = (...paths: string[]) => new Map(paths.map((p) => [p, `blob-${p}`]));

describe("lintCounts (019-13 slice 2)", () => {
  it("counts the findings of failures at the committed blob; a pass adds none", () => {
    const v = view(
      [state("src/a.ts", "fail"), state("src/b.ts", "fail"), state("src/c.ts", "pass")],
      [],
      {
        "src/a.ts": 2,
        "src/b.ts": 3,
      },
    );
    expect(lintCounts(v, committedOf("src/a.ts", "src/b.ts", "src/c.ts"), new Set())).toEqual({
      findings: 5,
      notDetermined: 0,
      running: 0,
    });
  });

  it("not determined: another blob, stale, unknown, or findings not stored", () => {
    const v = view(
      [
        state("src/a.ts", "fail", {}, "blob-worktree"),
        state("src/b.ts", "fail", { stale: true }),
        state("src/c.ts", "unknown"),
        state("src/d.ts", "fail"),
        state("src/e.ts", "fail"),
      ],
      [],
      { "src/d.ts": null },
    );
    const committed = committedOf("src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts");
    expect(lintCounts(v, committed, new Set(["src/a.ts"]))).toEqual({
      findings: 1,
      notDetermined: 4,
      running: 0,
    });
  });

  it("pending at a file that does not differ is running; at one that differs, not determined", () => {
    const v = view([state("src/a.ts", "pending"), state("src/b.ts", "pending")]);
    expect(lintCounts(v, committedOf("src/a.ts", "src/b.ts"), new Set(["src/b.ts"]))).toEqual({
      findings: 0,
      notDetermined: 1,
      running: 1,
    });
  });

  it("a whole-program check counts while nothing differs, and is not determined once anything does", () => {
    const v = view([state("src/a.ts", "fail"), state("src/b.ts", "fail")], ["src/a.ts"]);
    const committed = committedOf("src/a.ts", "src/b.ts");
    expect(lintCounts(v, committed, new Set())).toEqual({
      findings: 2,
      notDetermined: 0,
      running: 0,
    });
    expect(lintCounts(v, committed, new Set(["src/other.ts"]))).toEqual({
      findings: 1,
      notDetermined: 1,
      running: 0,
    });
  });
});

describe("readLintCounts from the lint store (019-13 slice 2)", () => {
  it("reads states, stored findings and the program's files per tool", () => {
    const dir = commonDir();
    const store = open(dir);
    const failing = state("src/a.ts", "fail");
    const whole = state("src/b.ts", "fail");
    store.states.upsertMany([failing, whole]);
    for (const s of [failing, whole]) {
      store.results.put(
        {
          check: s.check,
          key: s.judged?.key ?? "",
          outcome: "fail",
          findings: [finding("r", "one"), finding("r", "two", 2)],
          fingerprint: null,
          toolVersion: "1",
          lintedAt: 1,
        },
        1,
      );
    }
    writeProgram(store.meta, lintScope(W, "eslint"), {
      segment: "s",
      files: ["src/b.ts"],
      extensions: [],
    });
    const committed = committedOf("src/a.ts", "src/b.ts");
    expect(readLintCounts(dir, LINT_ON.lint, W, committed, new Set())).toEqual({
      findings: 4,
      notDetermined: 0,
      running: 0,
    });
    expect(readLintCounts(dir, LINT_ON.lint, W, committed, new Set(["src/c.ts"]))).toEqual({
      findings: 2,
      notDetermined: 1,
      running: 0,
    });
  });

  it("no lint part while lint is off or no store exists", () => {
    const dir = commonDir();
    expect(readLintCounts(dir, LINT_ON.lint, W, new Map(), new Set())).toBeUndefined();
    open(dir);
    const off = { ...LINT_ON.lint, enabled: false };
    expect(readLintCounts(dir, off, W, new Map(), new Set())).toBeUndefined();
    expect(readLintCounts(dir, LINT_ON.lint, W, new Map(), new Set())).toEqual({
      findings: 0,
      notDetermined: 0,
      running: 0,
    });
  });
});
