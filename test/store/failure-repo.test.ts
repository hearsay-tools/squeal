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
          expect(plan.some((step) => /^SCAN (r|c)\b/.test(step))).toBe(false);
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
