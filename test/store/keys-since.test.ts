import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { storePaths } from "../../src/core/store/index.js";
import { KEYS_SINCE } from "../../src/core/store/repos/results.js";
import { fakeCommonDir, open, result, testCheck } from "./helpers.js";

/*
 * Spec 011 C4 step 3 as amended 2026-10-20 (task 011-23): every
 * reconciliation pass and tier selection reads the keys stored since the
 * last read, so the read must range over `results_by_time` (`KEYS_SINCE`).
 */

describe("results.keysSince (011-23)", () => {
  it("returns each key recorded after `since` once, with its newest record time", () => {
    const store = open(fakeCommonDir());
    store.results.putMany([
      result(testCheck("one"), "old", { recordedAt: 10 }),
      result(testCheck("one"), "k1", { recordedAt: 20 }),
      result(testCheck("two"), "k1", { recordedAt: 30 }),
      result(testCheck("one"), "k2", { recordedAt: 25 }),
    ]);
    const read = (since: number) =>
      [...store.results.keysSince(since)].sort((a, b) => a.key.localeCompare(b.key));
    expect(read(10)).toEqual([
      { key: "k1", recordedAt: 30 },
      { key: "k2", recordedAt: 25 },
    ]);
    expect(read(25)).toEqual([{ key: "k1", recordedAt: 30 }]);
    expect(read(30)).toEqual([]);
  });

  it("ranges over results_by_time", () => {
    const commonDir = fakeCommonDir();
    open(commonDir);
    const db = new DatabaseSync(storePaths(commonDir).database, { readOnly: true });
    try {
      const plan = db
        .prepare(`EXPLAIN QUERY PLAN ${KEYS_SINCE}`)
        .all(0)
        .map((row) => String(row.detail));
      expect(plan[0]).toMatch(/^SEARCH results USING INDEX results_by_time \(recorded_at>\?\)/);
    } finally {
      db.close();
    }
  });
});
