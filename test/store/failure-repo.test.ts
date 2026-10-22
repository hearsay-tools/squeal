import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { recordsForFile } from "../../src/core/scheduler/records.js";
import { describeFailure } from "../../src/core/state/index.js";
import { storePaths } from "../../src/core/store/index.js";
import { FAILURE_STATEMENTS } from "../../src/core/store/repos/failures.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { FailureSelection, RunReport, TestFileRef } from "../../src/core/types/index.js";
import { fakeCommonDir, open, result, testCheck } from "./helpers.js";

/*
 * Row 011-75 (011-64 R1, section 1): `squeal failures` reads its selection
 * through `results_by_failure`, whose column is set on every failing row and
 * on no other, so the list and the count search the failing rows instead of
 * scanning every result.
 */

const EVERY: FailureSelection = { worktreeId: null, since: null, paths: [], checks: null };

describe("store.failures (row 011-75)", () => {
  it("lists, counts and names the failing checks of a selection", () => {
    const store = open(fakeCommonDir());
    store.results.putMany([
      result(testCheck("one", "src/a/x.test.ts"), "k1", { outcome: "fail", recordedAt: 10 }),
      result(testCheck("two", "src/a/x.test.ts"), "k1", { outcome: "pass", recordedAt: 20 }),
      result(testCheck("one", "src/ab.test.ts"), "k2", {
        outcome: "fail",
        worktreeId: "wt-b",
        recordedAt: 30,
      }),
      result(testCheck("one", "src/a/x.test.ts"), "k3", { outcome: "fail", recordedAt: 40 }),
    ]);

    expect(store.failures.list(EVERY, 10).map((r) => r.key)).toEqual(["k3", "k2", "k1"]);
    expect(store.failures.list(EVERY, 2).map((r) => r.key)).toEqual(["k3", "k2"]);
    expect(store.failures.count(EVERY)).toBe(3);
    const dir: FailureSelection = { ...EVERY, paths: ["src/a"] };
    expect(store.failures.list(dir, 10).map((r) => r.key)).toEqual(["k3", "k1"]);
    expect(store.failures.count({ ...dir, worktreeId: "wt-b" })).toBe(0);
    expect(store.failures.count({ ...EVERY, since: 30 })).toBe(2);
    expect(store.failures.failingChecks(EVERY)).toEqual([
      testCheck("one", "src/a/x.test.ts"),
      testCheck("one", "src/ab.test.ts"),
    ]);
    const byCheck = { ...EVERY, checks: [testCheck("one", "src/ab.test.ts")] };
    expect(store.failures.list(byCheck, 10).map((r) => r.key)).toEqual(["k2"]);
    expect(store.failures.count({ ...EVERY, checks: [] })).toBe(0);
  });

  // Review 0.1.262 B1: a grouped notice's command selects its checks by their error and lists
  // each check once, however many failures each has stored.
  it("selects by a part of the summary, and each check's newest selected failure", () => {
    const store = open(fakeCommonDir());
    const failed = (name: string, key: string, recordedAt: number, message: string) => ({
      ...result(testCheck(name, "src/a.test.ts"), key, { outcome: "fail", recordedAt }),
      summary: `Error: ${message}`,
    });
    store.results.putMany([
      failed("one", "k1", 10, "ResizeObserver is not defined"),
      failed("one", "k2", 20, "ResizeObserver is not defined"),
      failed("one", "k3", 30, "fetch failed"),
      failed("two", "k1", 15, "ResizeObserver is not defined"),
      failed("three", "k1", 40, "resizeobserver is not defined"),
    ]);
    const keys = (selection: FailureSelection) =>
      store.failures
        .list(selection, 10)
        .map((r) => `${r.check.kind === "test" ? r.check.fullName : ""} ${r.key}`);

    const resize: FailureSelection = { ...EVERY, errors: ["ResizeObserver"] };
    expect(keys(resize)).toEqual(["one k2", "two k1", "one k1"]);
    expect(store.failures.count(resize)).toBe(3);
    expect(keys({ ...EVERY, errors: ["ResizeObserver", "fetch"] })).toEqual([
      "one k3",
      "one k2",
      "two k1",
      "one k1",
    ]);
    expect(keys({ ...EVERY, errors: [] })).toHaveLength(5);

    // The newest of each check among the failures with that error, not its newest failure.
    const each: FailureSelection = { ...resize, perCheck: true };
    expect(keys(each)).toEqual(["one k2", "two k1"]);
    expect(store.failures.count(each)).toBe(2);
    expect(keys({ ...EVERY, perCheck: true })).toEqual(["three k1", "one k3", "two k1"]);
    expect(keys({ ...EVERY, perCheck: true, since: 16 })).toEqual(["three k1", "one k3"]);
    expect(store.failures.count({ ...EVERY, perCheck: true, worktreeId: "wt-b" })).toBe(0);
  });

  it("names results_by_failure in the plan of every list, count and failing-checks query", () => {
    const commonDir = fakeCommonDir();
    open(commonDir);
    const db = new DatabaseSync(storePaths(commonDir).database, { readOnly: true });
    const selections: FailureSelection[] = [
      EVERY,
      { worktreeId: "wt-main", since: 5, paths: [], checks: null },
      { ...EVERY, paths: ["src/a.test.ts", "src/dir"] },
      { ...EVERY, checks: [testCheck("one")] },
      { worktreeId: "wt-main", since: 5, paths: ["src"], checks: [testCheck("one")] },
      { ...EVERY, errors: ["ResizeObserver"], perCheck: true },
      { worktreeId: "wt-main", since: 5, paths: ["src"], checks: null, errors: ["a", "b"] },
      { worktreeId: "wt-main", since: null, paths: ["src"], checks: null, perCheck: true },
    ];
    try {
      for (const selection of selections) {
        for (const { sql, params } of [
          FAILURE_STATEMENTS.list(selection, 20),
          FAILURE_STATEMENTS.count(selection),
          FAILURE_STATEMENTS.failingChecks(selection),
        ]) {
          const plan = db
            .prepare(`EXPLAIN QUERY PLAN ${sql}`)
            .all(...params)
            .map((row) => String(row.detail));
          // The failing rows are the outer loop; each joins its check by primary key.
          expect(plan[0]).toBe("SEARCH r USING INDEX results_by_failure (failure_id>?)");
          expect(plan).toContain("SEARCH c USING INTEGER PRIMARY KEY (rowid=?)");
          expect(plan.some((step) => /^SCAN (r|c|n|t)\b/.test(step))).toBe(false);
        }
      }
    } finally {
      db.close();
    }
  });

  /*
   * The premise of the index (design section 1): every fail `recordsForFile`
   * returns has a summary, from `describeFailure`, so `putMany` stores a
   * failure text and sets `failure_id`; a pass or a skip gets none.
   */
  it("stores a failure text for every fail recordsForFile returns, and none for a pass or skip", () => {
    const store = open(fakeCommonDir());
    const ref: TestFileRef = { project: "", path: "test/a.test.ts" };
    const at = { path: "test/a.test.ts", line: 3, column: 5 };
    const report: RunReport = {
      end: "completed",
      durationMs: 10,
      completedFiles: [ref],
      results: [
        {
          check: testCheck("bare", ref.path),
          outcome: "fail",
          durationMs: 1,
          location: at,
          errors: [],
        },
        {
          check: testCheck("thrown", ref.path),
          outcome: "fail",
          durationMs: 1,
          location: null,
          errors: [{ name: "Error", message: "", stack: null, location: null, diff: null }],
        },
        {
          check: testCheck("passes", ref.path),
          outcome: "pass",
          durationMs: 1,
          location: at,
          errors: [],
        },
        {
          check: testCheck("skips", ref.path),
          outcome: "skip",
          durationMs: 0,
          location: at,
          errors: [],
        },
      ],
      fileErrors: [
        {
          testFile: ref,
          errors: [{ name: "Error", message: "after", stack: null, location: null, diff: null }],
        },
      ],
      failure: null,
    };
    const records = recordsForFile({
      ref,
      key: "k1",
      report,
      previousChecks: [testCheck("gone", ref.path)],
      provenance: {
        worktreeId: "wt",
        revision: 1,
        commit: null,
        dirty: false,
        runId: "run-1",
        recordedAt: 1,
      },
      describe: describeFailure,
    });
    const fails = records.filter((r) => r.outcome === "fail");
    expect(fails.length).toBe(4);
    for (const r of fails) expect(r.summary).not.toBeNull();

    store.results.putMany(records);
    const rows = connectionOf(store).all(
      "SELECT outcome, failure_id IS NOT NULL AS has_text, COUNT(*) AS n FROM results GROUP BY 1, 2 ORDER BY 1",
    );
    expect(rows).toEqual([
      { outcome: "fail", has_text: 1, n: 4 },
      { outcome: "pass", has_text: 0, n: 1 },
      { outcome: "skip", has_text: 0, n: 1 },
    ]);
    expect(store.failures.count(EVERY)).toBe(4);
  });
});
