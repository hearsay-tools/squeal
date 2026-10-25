import { num } from "../../store/codec.js";
import type { Connection } from "../../store/connection.js";
import type { CodeCoverageRepo } from "./types.js";

/** `CODE_INDEXES`'s index of each record's stored time (row 015-44). */
const INDEX = "coverage_stored";

/**
 * Spec 015 D8: coverage records at their test file's result key and the
 * provider's version. The key names the result's inputs, so a worktree that
 * adopts the result finds the record at the same key (011-23), and prune
 * drops it when no result is left at that key (C7). A record stored over
 * another gets a later `recorded_at` than it, also within one ms, so the
 * stored time names the record (row 015-44).
 */
export function createCoverageRepo(conn: Connection): CodeCoverageRepo {
  // Row 015-44: the index gives `recorded_at` without the row's blob; a store a daemon that
  // predates it left, opened by a reader, has none.
  const indexed =
    conn.get("SELECT 1 AS found FROM sqlite_master WHERE type = 'index' AND name = ?", INDEX) !==
    null;
  const by = indexed ? `coverage INDEXED BY ${INDEX}` : "coverage";
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
      const row = conn.get(
        "SELECT record FROM coverage WHERE result_key = ? AND provider_version = ?",
        key.resultKey,
        key.providerVersion,
      );
      const record = row?.record;
      return record instanceof Uint8Array ? record : null;
    },
    has: (key) => storedAt(key) !== null,
    storedAt,
    put(key, record, at) {
      conn.run(
        `INSERT INTO coverage (result_key, provider_version, record, recorded_at) VALUES (?, ?, ?, ?)
         ON CONFLICT DO UPDATE SET record = excluded.record,
           recorded_at = max(excluded.recorded_at, recorded_at + 1)`,
        key.resultKey,
        key.providerVersion,
        record,
        at,
      );
    },
  };
}
