import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { storePaths } from "../../src/core/store/paths.js";
import { KEYS_WITH_RESULTS } from "../../src/core/store/repos/results.js";
import { fakeCommonDir, open, result, testCheck } from "./helpers.js";

/*
 * Row 011-315: the code store's prune asks the main store only about the keys
 * its coverage records hold, one index search each, instead of reading every
 * result key (`keysSince(0)`, 23.6 s an hour on cezar's store).
 */

describe("results.keysWithResults (011-315)", () => {
  it("answers the keys with a result, each once, in the order asked", () => {
    const store = open(fakeCommonDir());
    store.results.putMany([
      result(testCheck("one"), "k1", { recordedAt: 10 }),
      result(testCheck("two"), "k1", { recordedAt: 20 }),
      result(testCheck("one"), "k3", { recordedAt: 30 }),
    ]);

    expect(store.results.keysWithResults(["k3", "k2", "k1", "k3"])).toEqual(["k3", "k1"]);
    expect(store.results.keysWithResults([])).toEqual([]);
  });

  it("answers past the first chunk of keys", () => {
    const store = open(fakeCommonDir());
    const keys = Array.from({ length: 2_500 }, (_, i) => `k${i}`);
    const stored = keys.filter((_, i) => i % 7 === 0 || i === 2_499);
    store.results.putMany(stored.map((key) => result(testCheck("one"), key)));

    expect(store.results.keysWithResults(keys)).toEqual(stored);
  });

  it("searches results_by_key once per key", () => {
    const commonDir = fakeCommonDir();
    open(commonDir);
    const db = new DatabaseSync(storePaths(commonDir).database, { readOnly: true });
    try {
      const plan = db
        .prepare(`EXPLAIN QUERY PLAN ${KEYS_WITH_RESULTS}`)
        .all("[]")
        .map((row) => String(row.detail));
      expect(plan).toContainEqual(
        expect.stringMatching(
          /^SEARCH results (EXISTS )?USING COVERING INDEX results_by_key \(key=\?\)/,
        ),
      );
      expect(plan.join("\n")).not.toMatch(/SCAN results/);
    } finally {
      db.close();
    }
  });
});
