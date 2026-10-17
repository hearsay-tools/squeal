import type { Store } from "../types/index.js";
import { str } from "./codec.js";
import { connectionOf } from "./store.js";

/** `meta` key holding the fingerprint rules' version the stored fingerprints follow. */
export const META_FINGERPRINT_RULES = "fingerprint.rules";

/** Every column holding a diagnostic fingerprint. */
const COLUMNS = [
  ["results", "fingerprint"],
  ["known_states", "fingerprint"],
  ["transitions", "from_fingerprint"],
  ["transitions", "to_fingerprint"],
  ["consumer_views", "fingerprint"],
] as const;

/**
 * Task 011-14: once per store for each version of the fingerprint rules,
 * every stored fingerprint is put through `rewrite`, so a standing failure
 * whose fingerprint the previous rules wrote does not read as a changed
 * failure when the current rules describe it again. Results, known states,
 * the audit log and consumer views change together, in one transaction, and
 * stay comparable with each other. Returns how many rows changed; 0 when the
 * store already follows `version`.
 */
export function rewriteFingerprints(
  store: Store,
  version: number,
  rewrite: (fingerprint: string) => string,
): number {
  const conn = connectionOf(store);
  return conn.transaction(() => {
    if (store.meta.get(META_FINGERPRINT_RULES) === String(version)) return 0;
    let changed = 0;
    for (const [table, column] of COLUMNS) {
      const rows = conn.all(
        `SELECT DISTINCT ${column} AS f FROM ${table} WHERE ${column} IS NOT NULL`,
      );
      for (const row of rows) {
        const from = str(row, "f");
        const to = rewrite(from);
        if (to !== from) {
          changed += conn.run(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`, to, from);
        }
      }
    }
    store.meta.set(META_FINGERPRINT_RULES, String(version));
    return changed;
  });
}
