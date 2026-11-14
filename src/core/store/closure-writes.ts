import type { MetaRepo } from "../types/store.js";
import type { Connection } from "./connection.js";

/*
 * Row 011-44: a cheap marker of closure writes. Every write of a
 * `test_files` row (a closure recorded or removed) sets this marker to a new
 * random value in the same transaction, after the row, so a reader that read
 * the marker before the rows never keeps rows older than the marker it read.
 * A named wait keeps the closures it read across polls and reads them again
 * only when the marker moved. A random value, not a counter, so a store made
 * again from nothing never repeats a value a reader holds. A store no writer
 * of this release wrote has no marker: its reader reads every closure each
 * time, as before. The key is the store's, shared by every worktree, since a
 * closure record is the repository's.
 */

/** The `meta` key of the closure-write marker. Row 011-45's state marker has its own. */
export const CLOSURE_WRITES_KEY = "closure-writes";

/** Moves the marker; call it after the `test_files` write, in its transaction. */
export function markClosureWrite(conn: Connection): void {
  conn.run(
    "INSERT OR REPLACE INTO meta (key, value) VALUES (?, lower(hex(randomblob(8))))",
    CLOSURE_WRITES_KEY,
  );
}

/** The marker as last moved, `null` when no writer has moved it in this store. */
export function closureWrites(meta: MetaRepo): string | null {
  return meta.get(CLOSURE_WRITES_KEY);
}
