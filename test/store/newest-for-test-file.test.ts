import { describe, expect, it } from "vitest";
import { connectionOf } from "../../src/core/store/store.js";
import type { FileCheckId } from "../../src/core/types/index.js";
import { fakeCommonDir, open, result, testCheck } from "./helpers.js";

/*
 * Row 011-154: a miss with no previous key, as at a new worktree's first
 * start, takes its last duration from the file's results under the key of
 * its newest result, from any worktree, read without advancing last-used.
 */
const A = { project: "", path: "src/a.test.ts" };
const fileCheck: FileCheckId = { kind: "file", project: "", testPath: A.path };

describe("store: a test file's results under its newest key (011-154)", () => {
  it("reads the file's rows of the key its newest row names, from any worktree", () => {
    const store = open(fakeCommonDir());
    const one = testCheck("one");
    const two = testCheck("two");
    const elsewhere = testCheck("one", "src/b.test.ts");
    store.results.putMany([
      result(one, "old", { recordedAt: 1, worktreeId: "wt-a" }),
      result(two, "old", { recordedAt: 1, worktreeId: "wt-a" }),
      result(fileCheck, "new", { recordedAt: 5, worktreeId: "wt-b" }),
      result(one, "new", { recordedAt: 5, worktreeId: "wt-b", outcome: "fail" }),
      // Another file under the same key, and a later key of another file: neither is A's.
      result(elsewhere, "new", { recordedAt: 5, worktreeId: "wt-b" }),
      result(elsewhere, "later", { recordedAt: 9 }),
    ]);

    const rows = store.results.newestForTestFile(A);
    expect(rows.map((r) => [r.check.kind, r.key, r.provenance.worktreeId, r.outcome])).toEqual([
      ["file", "new", "wt-b", "pass"],
      ["test", "new", "wt-b", "fail"],
    ]);
    expect(rows[1]?.summary).toBe("expected 1 to be 2");
    expect(store.results.newestForTestFile({ project: "", path: "src/none.test.ts" })).toEqual([]);
    expect(store.results.newestForTestFile({ project: "other", path: A.path })).toEqual([]);
  });

  it("takes the key of the newest row whichever check holds it", () => {
    const store = open(fakeCommonDir());
    store.results.putMany([
      result(testCheck("one"), "k1", { recordedAt: 2 }),
      result(testCheck("two"), "k1", { recordedAt: 2 }),
      result(testCheck("two"), "k2", { recordedAt: 7 }),
    ]);
    expect(store.results.newestForTestFile(A).map((r) => [r.check, r.key])).toEqual([
      [testCheck("two"), "k2"],
    ]);
  });

  // Review 0.1.279 N1: on a tie of the newest record time, the row stored last names the key.
  it("takes the key of the row stored last when two rows share the newest record time", () => {
    const store = open(fakeCommonDir());
    store.results.putMany([{ ...result(testCheck("a"), "first"), durationMs: 10 }]);
    store.results.putMany([{ ...result(testCheck("b"), "second"), durationMs: 100 }]);
    expect(
      store.results
        .newestForTestFile(A)
        .map((r) => [r.check, r.key, r.durationMs, r.provenance.recordedAt]),
    ).toEqual([[testCheck("b"), "second", 100, 1_000]]);
  });

  it("never advances last-used", () => {
    const store = open(fakeCommonDir());
    store.results.putMany([result(testCheck("one"), "k1", { recordedAt: 3 })]);
    const lastUsed = () => connectionOf(store).all("SELECT key, last_used_at FROM results");
    const before = lastUsed();
    expect(store.results.newestForTestFile(A)).toHaveLength(1);
    expect(lastUsed()).toEqual(before);
  });
});
