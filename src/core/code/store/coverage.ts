import type { Connection } from "../../store/connection.js";
import type { CodeCoverageRepo } from "./types.js";

/**
 * Spec 015 D8: coverage records at their test file's result key and the
 * provider's version. The key names the result's inputs, so a worktree that
 * adopts the result finds the record at the same key (011-23), and prune
 * drops it when no result is left at that key (C7).
 */
export function createCoverageRepo(conn: Connection): CodeCoverageRepo {
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
    put(key, record, at) {
      conn.run(
        `INSERT INTO coverage (result_key, provider_version, record, recorded_at) VALUES (?, ?, ?, ?)
         ON CONFLICT DO UPDATE SET record = excluded.record, recorded_at = excluded.recorded_at`,
        key.resultKey,
        key.providerVersion,
        record,
        at,
      );
    },
  };
}
