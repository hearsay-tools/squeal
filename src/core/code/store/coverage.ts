import { num, str } from "../../store/codec.js";
import type { Connection } from "../../store/connection.js";
import {
  assemble,
  isManifest,
  manifestBytes,
  readManifest,
  type StoredPart,
  storedPart,
} from "../coverage/parts.js";
import { hasParts, PART_REFRESH_MS } from "./parts.js";
import type { CodeCoverageRepo, CoverageRecordPut } from "./types.js";

/** `CODE_INDEXES`'s index of each record's stored time (row 015-44). */
const INDEX = "coverage_stored";

/**
 * Parts kept read, by id: the records a CRAP step reads share most of
 * theirs, and a part's bytes never change under its id (row 015-85). About
 * 450 bytes each, so some 4 MB.
 */
const PART_CACHE_LIMIT = 8_192;

const UPSERT = `INSERT INTO coverage (result_key, provider_version, record, recorded_at) VALUES (?, ?, ?, ?)
  ON CONFLICT DO UPDATE SET record = excluded.record,
    recorded_at = max(excluded.recorded_at, recorded_at + 1)`;

/**
 * Spec 015 D8: coverage records at their test file's result key and the
 * record version (`COVERAGE_RECORD_VERSION`, in `provider_version`). The key names the result's inputs, so a worktree that
 * adopts the result finds the record at the same key (011-23), and prune
 * drops it when no result is left at that key (C7). A record stored over
 * another gets a later `recorded_at` than it, also within one ms, so the
 * stored time names the record (row 015-44). Since row 015-85 (D4) a
 * record is a manifest of its sources' parts in `coverage_parts`.
 */
/**
 * `sent`: how to wait for `conn`'s transactions to be written, for a
 * connection that hands them over (row 021-36); absent, they are written
 * at once, and `putParts` ends before it returns.
 */
export function createCoverageRepo(conn: Connection, sent?: () => Promise<void>): CodeCoverageRepo {
  // Row 015-44: the index gives `recorded_at` without the row's blob; a store a daemon that
  // predates it left, opened by a reader, has none.
  const indexed =
    conn.get("SELECT 1 AS found FROM sqlite_master WHERE type = 'index' AND name = ?", INDEX) !==
    null;
  const by = indexed ? `coverage INDEXED BY ${INDEX}` : "coverage";
  // A manifest is stored only after a writer made the table, which nothing drops.
  let parted = false;
  const read = new Map<number, StoredPart | null>();
  const partsOf = (ids: readonly number[]): ReadonlyMap<number, StoredPart | null> => {
    parted ||= hasParts(conn);
    const missing = ids.filter((id) => !read.has(id));
    if (!parted || missing.length === 0) return read;
    for (const row of conn.all(
      "SELECT id, part FROM coverage_parts WHERE id IN (SELECT value FROM json_each(?))",
      JSON.stringify(missing),
    )) {
      read.set(num(row, "id"), row.part instanceof Uint8Array ? storedPart(row.part) : null);
    }
    const wanted = new Set(ids);
    for (const id of read.keys()) {
      if (read.size <= PART_CACHE_LIMIT) break;
      if (!wanted.has(id)) read.delete(id);
    }
    return read;
  };
  const storedAt: CodeCoverageRepo["storedAt"] = (key) => {
    const row = conn.get(
      `SELECT recorded_at FROM ${by} WHERE result_key = ? AND provider_version = ?`,
      key.resultKey,
      key.providerVersion,
    );
    return row === null ? null : num(row, "recorded_at");
  };
  /** The record's parts, by hash, in a transaction: its stored time, at which each part is used. */
  const writeParts = ({ key, record, at }: CoverageRecordPut): number => {
    const before = storedAt(key);
    const stored = before === null ? at : Math.max(at, before + 1);
    const known = new Map<string, number>();
    for (const row of conn.all(
      `SELECT j.key AS i, p.used_at FROM json_each(?) j JOIN coverage_parts p ON p.hash = j.value`,
      JSON.stringify(record.parts.map((p) => p.hash)),
    )) {
      known.set(record.parts[num(row, "i")]?.hash ?? "", num(row, "used_at"));
    }
    for (const part of record.parts) {
      if (known.has(part.hash)) continue;
      known.set(part.hash, stored);
      conn.run(
        `INSERT INTO coverage_parts (hash, part, used_at) VALUES (?, ?, ?)
         ON CONFLICT (hash) DO UPDATE SET used_at = max(used_at, excluded.used_at)`,
        part.hash,
        part.bytes,
        stored,
      );
    }
    const stale = [...known].filter(([, usedAt]) => usedAt < stored - PART_REFRESH_MS);
    if (stale.length > 0) {
      conn.run(
        `UPDATE coverage_parts SET used_at = ?
         WHERE hash IN (SELECT value FROM json_each(?)) AND used_at < ?`,
        stored,
        JSON.stringify(stale.map(([hash]) => hash)),
        stored - PART_REFRESH_MS,
      );
    }
    return stored;
  };
  /** The record's manifest, naming its written parts by id, in a transaction. */
  const writeManifest = ({ key, record }: CoverageRecordPut, stored: number): void => {
    const ids = new Map<string, number>();
    for (const row of conn.all(
      `SELECT j.value AS hash, p.id FROM json_each(?) j JOIN coverage_parts p ON p.hash = j.value`,
      JSON.stringify(record.parts.map((p) => p.hash)),
    )) {
      ids.set(str(row, "hash"), num(row, "id"));
    }
    const listed = record.parts.map((part) => ids.get(part.hash));
    if (listed.some((id) => id === undefined)) {
      throw new Error("squeal code store: a coverage part is missing after its insert");
    }
    conn.run(
      UPSERT,
      key.resultKey,
      key.providerVersion,
      manifestBytes(record, listed as number[]),
      stored,
    );
  };
  /**
   * Row 021-36 (D22.5): two transactions, since a batch sent to the store process cannot
   * read back the ids its inserts made. The first writes the parts by hash, the second, once
   * the first is written (`sent`), the manifests that name them by id. A part the first wrote
   * or refreshed is used at its record's stored time, so no prune between the two takes it.
   * Row 024-03: every record of `items` in the same two transactions.
   */
  const putPartsBatch = async (items: readonly CoverageRecordPut[]): Promise<void> => {
    if (items.length === 0) return;
    const stored = conn.transaction(() => items.map(writeParts));
    if (sent !== undefined) await sent();
    conn.transaction(() => {
      items.forEach((item, i) => {
        writeManifest(item, stored[i] ?? item.at);
      });
    });
    if (sent !== undefined) await sent();
  };
  return {
    get(key) {
      return conn.read(() => {
        const row = conn.get(
          "SELECT record FROM coverage WHERE result_key = ? AND provider_version = ?",
          key.resultKey,
          key.providerVersion,
        );
        const record = row?.record;
        if (!(record instanceof Uint8Array)) return null;
        if (!isManifest(record)) return record;
        const manifest = readManifest(record);
        return manifest === null
          ? null
          : assemble(manifest, partsOf(manifest.parts.map((p) => p.id)));
      });
    },
    has: (key) => storedAt(key) !== null,
    storedAt,
    put(key, record, at) {
      conn.run(UPSERT, key.resultKey, key.providerVersion, record, at);
    },
    putParts: (key, record, at) => putPartsBatch([{ key, record, at }]),
    putPartsBatch,
  };
}
