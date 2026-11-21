import { describe, expect, it } from "vitest";
import { emptyLoadedModules, hasLoadedModulesTable } from "../../src/core/store/loaded-modules.js";
import { LIST_DELETE_BATCH } from "../../src/core/store/prune-rules.js";
import { connectionOf } from "../../src/core/store/store.js";
import { DAY_MS, fakeCommonDir, open, result, testCheck } from "./helpers.js";
import { oldListCount, putOldList } from "./loaded-lists.js";

/*
 * Spec 022 D3 (amended 2026-11-21, row 022-05): no list is stored; the
 * prune empties the lists an older release stored, in slices.
 */

const NOW = 100 * DAY_MS;

describe("the loaded_modules table an older release left (spec 022 D3, row 022-05)", () => {
  it("is emptied over several slices, with no result kept for its keys", () => {
    const store = open(fakeCommonDir());
    const conn = connectionOf(store);
    const rows = 3 * LIST_DELETE_BATCH;
    conn.transaction(() => {
      for (let i = 0; i < rows; i++) putOldList(conn, `k${i}`, `t${i}.test.ts`);
    });
    store.results.putMany([result(testCheck("c1"), "k0", { recordedAt: NOW - DAY_MS })]);
    let deletes = 0;
    for (const slice of emptyLoadedModules(conn)) {
      const before = oldListCount(conn);
      slice();
      if (oldListCount(conn) < before) {
        deletes++;
        expect(before - oldListCount(conn)).toBeLessThanOrEqual(LIST_DELETE_BATCH);
      }
    }
    expect(deletes).toBe(3);
    expect(oldListCount(conn)).toBe(0);
    expect(hasLoadedModulesTable(conn)).toBe(true);
    expect(store.results.byKey("k0")).toHaveLength(1);
  });

  it("is emptied by the store's prune", () => {
    const store = open(fakeCommonDir());
    const conn = connectionOf(store);
    store.results.putMany([result(testCheck("c1"), "k-kept", { recordedAt: NOW - DAY_MS })]);
    putOldList(conn, "k-kept");
    putOldList(conn, "k-orphan", "b.test.ts");
    store.prune({ now: NOW, retentionDays: 7, maxSizeMb: null });
    expect(oldListCount(conn)).toBe(0);
    expect(store.results.byKey("k-kept")).toHaveLength(1);
  });

  it("is not made by a prune of a store without it", () => {
    const store = open(fakeCommonDir());
    const conn = connectionOf(store);
    expect([...emptyLoadedModules(conn)]).toEqual([]);
    expect(() => store.prune({ now: NOW, retentionDays: 7, maxSizeMb: null })).not.toThrow();
    expect(hasLoadedModulesTable(conn)).toBe(false);
  });
});
