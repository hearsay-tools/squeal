import { describe, expect, it } from "vitest";
import type { CheckKey, ResultRecord, Store } from "../../src/core/types/index.js";
import { fakeCommonDir, open, testCheck } from "../store/helpers.js";

/*
 * Spec 011 C7 as amended 2026-10-20 (task 011-38): "A set copied from a format
 * read as one (C3) keeps its run's provenance and record time and is written
 * only under a key that holds no row, so it never replaces a stored set or
 * mixes with one."
 */

const CURRENT = "c".repeat(64) as CheckKey;
const [K16, K17, K12] = ["6", "7", "2"].map((c) => c.repeat(64) as CheckKey) as [
  CheckKey,
  CheckKey,
  CheckKey,
];

function row(key: CheckKey, name: string, at: number, worktreeId = "wt-old"): ResultRecord {
  return {
    check: testCheck(name),
    key,
    outcome: name === "fails" ? "fail" : "pass",
    durationMs: 3,
    location: null,
    fingerprint: name === "fails" ? "fp" : null,
    summary: name === "fails" ? "Error: no" : null,
    errors: [],
    provenance: {
      worktreeId,
      revision: 4,
      commit: "a".repeat(40),
      dirty: true,
      runId: `run-${key.slice(0, 1)}-${at}`,
      recordedAt: at,
    },
  };
}

/** The rows at `key` with their key left out, as a copy must reproduce them. */
const unkeyed = (store: Store, key: CheckKey) =>
  store.results.byKey(key, 0).map(({ key: _, ...rest }) => rest);

describe("ResultRepo.copyNewest (011-38)", () => {
  it("copies the set with the newest record time, every row with its provenance and record time", () => {
    const store = open(fakeCommonDir());
    store.results.putMany([row(K16, "passes", 3_000), row(K16, "fails", 3_000)]);
    store.results.putMany([row(K17, "passes", 2_000), row(K17, "fails", 5_000)]);
    store.results.putMany([row(K12, "passes", 9_000)]);

    expect(store.results.copyNewest(CURRENT, [K16, K17])).toBe(true);
    expect(unkeyed(store, CURRENT)).toEqual(unkeyed(store, K17));
    expect(store.results.byKey(CURRENT, 0).map((r) => r.key)).toEqual([CURRENT, CURRENT]);
    // The sets copied from stay.
    expect(store.results.byKey(K17, 0)).toHaveLength(2);
    expect(store.results.byKey(K16, 0)).toHaveLength(2);
  });

  it("never replaces or mixes a set already at the key, even one older or smaller", () => {
    const store = open(fakeCommonDir());
    store.results.putMany([row(CURRENT, "passes", 1_000, "wt-here")]);
    const before = store.results.byKey(CURRENT, 0);
    store.results.putMany([row(K17, "passes", 8_000), row(K17, "fails", 8_000)]);

    expect(store.results.copyNewest(CURRENT, [K16, K17])).toBe(false);
    expect(store.results.byKey(CURRENT, 0)).toEqual(before);
  });

  it("writes nothing when no listed key holds a row, or none is listed", () => {
    const store = open(fakeCommonDir());
    store.results.putMany([row(K12, "passes", 1_000)]);

    expect(store.results.copyNewest(CURRENT, [K16, K17])).toBe(false);
    expect(store.results.copyNewest(CURRENT, [])).toBe(false);
    expect(store.results.byKey(CURRENT, 0)).toEqual([]);
  });
});
