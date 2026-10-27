import { num } from "../../store/codec.js";
import type { Connection } from "../../store/connection.js";
import { assemble, isManifest, manifestBytes, readManifest } from "../coverage/parts.js";
import { hasParts, PART_REFRESH_MS } from "./parts.js";
import type { CodeCoverageRepo } from "./types.js";

/** `CODE_INDEXES`'s index of each record's stored time (row 015-44). */
const INDEX = "coverage_stored";

const UPSERT = `INSERT INTO coverage (result_key, provider_version, record, recorded_at) VALUES (?, ?, ?, ?)
  ON CONFLICT DO UPDATE SET record = excluded.record,
    recorded_at = max(excluded.recorded_at, recorded_at + 1)`;

/**
 * Spec 015 D8: coverage records at their test file's result key and the
 * provider's version. The key names the result's inputs, so a worktree that
 * adopts the result finds the record at the same key (011-23), and prune
 * drops it when no result is left at that key (C7). A record stored over
 * another gets a later `recorded_at` than it, also within one ms, so the
 * stored time names the record (row 015-44). Since row 015-85 (D4) a
 * record is a manifest of its sources' parts in `coverage_parts`.
 */
export function createCoverageRepo(conn: Connection): CodeCoverageRepo {
  // Row 015-44: the index gives `recorded_at` without the row's blob; a store a daemon that
  // predates it left, opened by a reader, has none.
  const indexed =
    conn.get("SELECT 1 AS found FROM sqlite_master WHERE type = 'index' AND name = ?", INDEX) !==
    null;
  const by = indexed ? `coverage INDEXED BY ${INDEX}` : "coverage";
  // A manifest is stored only after a writer made the table, which nothing drops.
  let parted = false;
  const partsOf = (ids: readonly number[]): Map<number, Uint8Array> => {
    parted ||= hasParts(conn);
    if (!parted) return new Map();
    const rows = conn.all(
      "SELECT id, part FROM coverage_parts WHERE id IN (SELECT value FROM json_each(?))",
      JSON.stringify(ids),
    );
    return new Map(rows.map((row) => [num(row, "id"), row.part as Uint8Array]));
  };
  const storedAt: CodeCoverageRepo["storedAt"] = (key) => {
    const row = conn.get(
      `SELECT recorded_at FROM ${by} WHERE result_key = ? AND provider_version = ?`,
      key.resultKey,
      key.providerVersion,
    );
    return row === null ? null : num(row, "recorded_at");
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
    putParts(key, record, at) {
      conn.transaction(() => {
        const before = storedAt(key);
        const stored = before === null ? at : Math.max(at, before + 1);
        const known = new Map<string, { readonly id: number; readonly usedAt: number }>();
        for (const row of conn.all(
          "SELECT id, hash, used_at FROM coverage_parts WHERE hash IN (SELECT value FROM json_each(?))",
          JSON.stringify(record.parts.map((p) => p.hash)),
        )) {
          known.set(String(row.hash), { id: num(row, "id"), usedAt: num(row, "used_at") });
        }
        const stale = [...known.values()]
          .filter((p) => p.usedAt < stored - PART_REFRESH_MS)
          .map((p) => p.id);
        const ids = record.parts.map((part) => {
          const found = known.get(part.hash);
          if (found !== undefined) return found.id;
          const made = conn.get(
            "INSERT INTO coverage_parts (hash, part, used_at) VALUES (?, ?, ?) RETURNING id",
            part.hash,
            part.bytes,
            stored,
          );
          const id = made === null ? 0 : num(made, "id");
          known.set(part.hash, { id, usedAt: stored });
          return id;
        });
        if (stale.length > 0) {
          conn.run(
            "UPDATE coverage_parts SET used_at = ? WHERE id IN (SELECT value FROM json_each(?)) AND used_at < ?",
            stored,
            JSON.stringify(stale),
            stored - PART_REFRESH_MS,
          );
        }
        conn.run(UPSERT, key.resultKey, key.providerVersion, manifestBytes(record, ids), stored);
      });
    },
  };
}
