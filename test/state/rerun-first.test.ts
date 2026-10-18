import { describe, expect, it } from "vitest";
import {
  checkIdentity,
  RERUN_FIRST_KEPT,
  RERUN_FIRST_META_KEY,
  readRerunFirstFailures,
  recordRerunFirstFailures,
} from "../../src/core/state/index.js";
import { check, FILE, freshStore, OTHER, result, WT } from "./helpers.js";

/*
 * Review wave-2b B2 (gh-20): the first error of a re-run is kept apart from
 * the flaky note, per check, bounded, and tied to its key and run.
 */
describe("recordRerunFirstFailures", () => {
  it("keeps each failing check of the file at the key with its run, and nothing else", () => {
    const store = freshStore();
    const [a, b] = [check("a"), check("b")];
    const elsewhere = check("c", { project: "", path: "src/other.test.ts" });
    store.results.putMany([
      result(a, "fail", { message: "FIRST_ERROR" }),
      result(b, "pass"),
      result(elsewhere, "fail"),
      result(b, "fail", { key: "k2" }),
    ]);

    recordRerunFirstFailures(store, FILE, "k1", 7);

    expect([...readRerunFirstFailures(store)]).toEqual([
      [
        checkIdentity(a),
        { key: "k1", runId: "run-1", worktreeId: WT, failure: "FIRST_ERROR", at: 7 },
      ],
    ]);
  });

  it("writes nothing without a failure and keeps the newest records", () => {
    const store = freshStore();
    recordRerunFirstFailures(store, FILE, "k1", 1);
    expect(store.meta.get(RERUN_FIRST_META_KEY)).toBeNull();

    const kept = { key: "k0", runId: "run-0", worktreeId: OTHER, failure: "old" };
    const full = Array.from({ length: RERUN_FIRST_KEPT }, (_, n) => [
      checkIdentity(check(`t${n}`)),
      { ...kept, at: n },
    ]);
    store.meta.set(RERUN_FIRST_META_KEY, JSON.stringify(Object.fromEntries(full)));
    const c = check(`t${RERUN_FIRST_KEPT}`);
    store.results.putMany([result(c, "fail")]);
    recordRerunFirstFailures(store, FILE, "k1", RERUN_FIRST_KEPT);

    const records = readRerunFirstFailures(store);
    expect(records.size).toBe(RERUN_FIRST_KEPT);
    expect(records.has(checkIdentity(check("t0")))).toBe(false);
    expect(records.get(checkIdentity(c))).toMatchObject({ key: "k1", at: RERUN_FIRST_KEPT });
  });

  it("reads a damaged row as none, and skips a malformed record", () => {
    const store = freshStore();
    store.meta.set(RERUN_FIRST_META_KEY, "{");
    expect(readRerunFirstFailures(store).size).toBe(0);
    store.meta.set(RERUN_FIRST_META_KEY, JSON.stringify({ x: { key: "k1" } }));
    expect(readRerunFirstFailures(store).size).toBe(0);
  });
});
