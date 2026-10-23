import { strOrNull } from "../codec.js";
import type { Connection } from "../connection.js";

/*
 * A JSON list kept under one `meta` key: the replaced failures (row 011-77)
 * and the UNKNOWN runs (row 011-108) keep theirs so. Like both, this module
 * is off the key-format alarm's path.
 */

/** The list under `key`, in its stored order; empty when none or unreadable, and an entry `guard` rejects is left out. */
export function readMetaList<T>(
  conn: Connection,
  key: string,
  guard: (value: unknown) => value is T,
): T[] {
  const row = conn.get("SELECT value FROM meta WHERE key = ?", key);
  if (row === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(strOrNull(row, "value") ?? "[]");
  } catch {
    return [];
  }
  return Array.isArray(value) ? value.filter(guard) : [];
}

/** Stores `entries` under `key`; an empty list deletes the key. */
export function writeMetaList(conn: Connection, key: string, entries: readonly unknown[]): void {
  if (entries.length === 0) conn.run("DELETE FROM meta WHERE key = ?", key);
  else {
    conn.run(
      "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
      key,
      JSON.stringify(entries),
    );
  }
}
