import { describe, expect, it } from "vitest";
import {
  hasLoadedModulesTable,
  LOADED_MODULES_TABLE,
  type LoadedModulesRecord,
  writeLoadedModules,
} from "../../src/core/store/loaded-modules.js";
import { SCHEMA_VERSION } from "../../src/core/store/schema.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { Store } from "../../src/core/types/store.js";
import { DAY_MS, fakeCommonDir, open, result, testCheck } from "./helpers.js";

/*
 * Spec 022 D3 (row 022-03): the loaded lists' table, made by the first
 * write with no `user_version` raise, and pruned with the last result at a
 * list's key.
 */

const NOW = 100 * DAY_MS;

function record(key: string, path = "a.test.ts"): LoadedModulesRecord {
  return {
    project: "",
    path,
    key,
    recordedAt: NOW,
    modules: [
      { path: "src/a.ts", hash: "1".repeat(40) },
      { path, hash: "2".repeat(40) },
    ],
  };
}

function keysOf(store: Store): string[] {
  return connectionOf(store)
    .all(`SELECT key FROM ${LOADED_MODULES_TABLE} ORDER BY key`)
    .map((row) => String(row.key));
}

describe("the loaded_modules table (spec 022 D3)", () => {
  it("is made by the first write, replaces the list at a key, and raises no user_version", () => {
    const store = open(fakeCommonDir());
    const conn = connectionOf(store);
    expect(hasLoadedModulesTable(conn)).toBe(false);
    writeLoadedModules(store, record("k1"));
    writeLoadedModules(store, { ...record("k1"), recordedAt: NOW + 1 });
    expect(hasLoadedModulesTable(conn)).toBe(true);
    const rows = conn.all(`SELECT * FROM ${LOADED_MODULES_TABLE}`);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.recorded_at)).toBe(NOW + 1);
    expect(JSON.parse(String(rows[0]?.modules))).toEqual(record("k1").modules);
    expect(Number(conn.get("PRAGMA user_version")?.user_version)).toBe(SCHEMA_VERSION);
  });

  it("leaves a store that holds it open to a reader that knows nothing of it", () => {
    const commonDir = fakeCommonDir();
    const first = open(commonDir);
    writeLoadedModules(first, record("k1"));
    first.results.putMany([result(testCheck("c1"), "k1")]);
    first.close();
    // This build's open is what an older build runs: the table is no part of its schema check.
    const again = open(commonDir);
    expect(again.results.byKey("k1")).toHaveLength(1);
    expect(keysOf(again)).toEqual(["k1"]);
  });

  it("records nothing in a store openStore did not open", () => {
    expect(() => writeLoadedModules({} as Store, record("k1"))).not.toThrow();
  });

  it("is pruned with the last result at a list's key", () => {
    const store = open(fakeCommonDir());
    store.results.putMany([
      result(testCheck("c1"), "k-old", { recordedAt: NOW - 30 * DAY_MS, worktreeId: "gone" }),
      result(testCheck("c2"), "k-kept", { recordedAt: NOW - DAY_MS, worktreeId: "gone" }),
    ]);
    writeLoadedModules(store, record("k-old", "c1.test.ts"));
    writeLoadedModules(store, record("k-kept", "c2.test.ts"));
    writeLoadedModules(store, record("k-orphan", "c3.test.ts"));

    store.prune({ now: NOW, retentionDays: 7, maxSizeMb: null });

    expect(store.results.byKey("k-old")).toEqual([]);
    expect(keysOf(store)).toEqual(["k-kept"]);
  });

  it("prunes nothing of a store without the table", () => {
    const store = open(fakeCommonDir());
    expect(() => store.prune({ now: NOW, retentionDays: 7, maxSizeMb: null })).not.toThrow();
    expect(hasLoadedModulesTable(connectionOf(store))).toBe(false);
  });
});
