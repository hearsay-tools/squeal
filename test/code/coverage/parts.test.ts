import { describe, expect, it } from "vitest";
import {
  type CoverageRecord,
  decodeRecord,
  encodeRecord,
} from "../../../src/core/code/coverage/index.js";
import { shareRecord } from "../../../src/core/code/coverage/parts.js";
import { coverageOf } from "../../../src/core/code/crap/file.js";
import type { FunctionCount } from "../../../src/core/types/code.js";
import { commonDir, open } from "../helpers.js";
import {
  A,
  at,
  B,
  C,
  C2,
  partRows,
  rawRecord,
  read,
  record,
  source,
  sql,
  V,
} from "./parts-fixtures.js";

/*
 * Row 015-85 (spec 015 D4, "An additive table after version 1"): each
 * source's part of a record is stored once, by the SHA-256 of its provider
 * version, path, blob and exact hits, and a record is a manifest of its
 * parts at its own key. These read back what was stored, so a part merged
 * or lost shows as wrong coverage, not only as a row count.
 */

describe("shared coverage parts (row 015-85)", () => {
  it("stores the parts two records of one test file share once, and reads each record back whole", () => {
    const dir = commonDir();
    const store = open(dir);
    const first = record([A, B, C]);
    const second = record([A, B, C2]);

    store.coverage.putParts(at("k1"), shareRecord(first, V), 1_000);
    store.coverage.putParts(at("k2"), shareRecord(second, V), 2_000);

    expect(partRows(dir)).toHaveLength(4);
    expect(read(store, "k1")).toEqual(first);
    expect(read(store, "k2")).toEqual(second);
    expect([store.coverage.storedAt(at("k1")), store.coverage.storedAt(at("k2"))]).toEqual([
      1_000, 2_000,
    ]);
  });

  it("never merges a part by its blob alone: other hits, another path or provider are their own", () => {
    const dir = commonDir();
    const store = open(dir);
    const records: Record<string, CoverageRecord> = {
      base: record([A]),
      line: record([source("src/a.ts", "blob-a", [1])]),
      hit: record([source("src/a.ts", "blob-a", [1, 2], 0)]),
      path: record([source("src/z.ts", "blob-a", [1, 2])]),
    };
    for (const [key, value] of Object.entries(records)) {
      store.coverage.putParts(at(key), shareRecord(value, V), 1_000);
    }
    store.coverage.putParts(
      at("base", V + 1),
      shareRecord(records.base as CoverageRecord, V + 1),
      1,
    );

    expect(partRows(dir)).toHaveLength(5);
    for (const [key, value] of Object.entries(records)) expect(read(store, key)).toEqual(value);
    expect(read(store, "base", V + 1)).toEqual(records.base);
  });

  it("keeps another record whole when a record that shares its parts is stored again", () => {
    const dir = commonDir();
    const store = open(dir);
    const shared = record([A, B, C]);
    store.coverage.putParts(at("k1"), shareRecord(shared, V), 1_000);
    store.coverage.putParts(at("k2"), shareRecord(shared, V), 1_000);

    // A later run at k1 ran less of b and none of c: its record replaces the first.
    const later = record([A, source("src/b.ts", "blob-b", [])]);
    store.coverage.putParts(at("k1"), shareRecord(later, V), 1_000);

    expect(read(store, "k1")).toEqual(later);
    expect(read(store, "k2")).toEqual(shared);
    expect(store.coverage.storedAt(at("k1"))).toBe(1_001);
    expect(partRows(dir)).toHaveLength(4);
  });

  it("keeps a record's own unread sources, and stores a record with no source", () => {
    const store = open(commonDir());
    const withUnread = record([A, C], ["src/b.ts", "src/d.ts"]);
    store.coverage.putParts(at("k1"), shareRecord(withUnread, V), 1_000);
    store.coverage.putParts(at("k2"), shareRecord(record([], ["src/b.ts"]), V), 1_000);
    store.coverage.putParts(at("k3"), shareRecord(record([]), V), 1_000);

    expect(read(store, "k1")).toEqual(withUnread);
    expect(read(store, "k2")).toEqual(record([], ["src/b.ts"]));
    expect(read(store, "k3")).toEqual(record([]));
  });

  it("reads a record an older daemon stored whole, and its write over a shared one", () => {
    const dir = commonDir();
    const store = open(dir);
    const legacy = record([A, B]);
    store.coverage.put(at("old"), encodeRecord(legacy), 1_000);
    store.coverage.putParts(at("k1"), shareRecord(record([A, C]), V), 1_000);
    // 0.1.362's `put`, word for word.
    sql(
      dir,
      `INSERT INTO coverage (result_key, provider_version, record, recorded_at) VALUES (?, ?, ?, ?)
         ON CONFLICT DO UPDATE SET record = excluded.record,
           recorded_at = max(excluded.recorded_at, recorded_at + 1)`,
      "k1",
      V,
      encodeRecord(legacy),
      1_000,
    );

    expect(read(store, "old")).toEqual(legacy);
    expect(read(store, "k1")).toEqual(legacy);
    expect(store.coverage.storedAt(at("k1"))).toBe(1_001);
  });
});

describe("a shared record read by a daemon that predates row 015-85", () => {
  const file = { path: "src/a.ts", blob: "blob-a" };
  const functions: FunctionCount[] = [
    {
      qualifiedName: "f",
      occurrence: 0,
      range: { startLine: 1, startColumn: 0, endLine: 4, endColumn: 1 },
      bodyHash: "h",
      complexity: 2,
      decisions: {},
    },
  ];
  const loader = { key: "k1", testFile: { project: "", path: "test/a.test.ts" }, storedAt: 1 };

  it("reads every source of it as unread, so none is judged from it", () => {
    const dir = commonDir();
    const store = open(dir);
    store.coverage.putParts(at("k1"), shareRecord(record([A, B], ["src/x.ts"]), V), 1_000);

    // What the released decoder makes of the row's own bytes.
    const old = decodeRecord(rawRecord(dir, "k1"));
    expect(old.sources).toEqual([]);
    expect(old.unread).toEqual(["src/a.ts", "src/b.ts", "src/x.ts"]);
    expect(coverageOf(file, functions, [loader], () => old)).toBe("unread");
    // The early judgement leaves it out, so it proves no pass.
    const early = coverageOf(file, functions, [loader], () => old, true);
    expect(early).not.toBe("unread");
    expect(early === "unread" ? [] : early.map((f) => f.runBy)).toEqual([[]]);
    // The same row, read now, holds the source.
    const now = read(store, "k1");
    expect(coverageOf(file, functions, [loader], () => now)).not.toBe("unread");
  });

  it("deletes no part when it prunes records, and the records it keeps read whole", () => {
    const dir = commonDir();
    const store = open(dir);
    store.coverage.putParts(at("k1"), shareRecord(record([A, B]), V), 1_000);
    store.coverage.putParts(at("k2"), shareRecord(record([A, C]), V), 1_000);
    // 0.1.362's coverage prune: the records whose result key the main store no longer holds.
    sql(
      dir,
      `DELETE FROM coverage WHERE (result_key, provider_version) IN (
         SELECT result_key, provider_version FROM coverage
         WHERE result_key NOT IN (SELECT value FROM json_each(?)) LIMIT 256)`,
      JSON.stringify(["k2"]),
    );

    expect(partRows(dir)).toHaveLength(3);
    expect(read(store, "k1")).toBeNull();
    expect(read(store, "k2")).toEqual(record([A, C]));
  });
});

describe("a part that is missing or not the source's", () => {
  it("reads as unread, never as a source the test file ran none of", () => {
    const dir = commonDir();
    const store = open(dir);
    store.coverage.putParts(at("k1"), shareRecord(record([A, B, C]), V), 1_000);
    const [a, b] = partRows(dir);
    sql(dir, "DELETE FROM coverage_parts WHERE id = ?", b?.id ?? 0);
    // c's part now holds a's bytes: a part that is not the path's own.
    sql(
      dir,
      "UPDATE coverage_parts SET part = (SELECT part FROM coverage_parts WHERE id = ?) WHERE id = ?",
      a?.id ?? 0,
      (a?.id ?? 0) + 2,
    );

    expect(read(store, "k1")).toEqual(record([A], ["src/b.ts", "src/c.ts"]));
  });
});
