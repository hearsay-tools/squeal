import type { WorktreeId } from "../types/common.js";
import { type Store, WORKTREE_META_ROWS, worktreeMetaKey } from "../types/store.js";
import type { Connection } from "./connection.js";
import { connectionOf } from "./store.js";

/*
 * Rows 011-44 and 011-45, as repaired after review 0.1.489 (B1): two
 * markers of writes, which let a wait keep what it read across its polls
 * and read it again only after a write.
 *
 * - The states marker, one `meta` row per worktree (`statesMarkerMetaKey`):
 *   moved by every write to the worktree's `known_states` or
 *   `test_file_keys` rows. The fallback `status --wait` keeps every state.
 * - The closure marker, one `meta` row for the store (`CLOSURE_WRITES_KEY`):
 *   moved by every write to `test_files`. A named wait keeps the closures.
 *
 * The database moves them, not the writers: an `AFTER INSERT`, `UPDATE`
 * and `DELETE` trigger on each table sets its marker to a new random value
 * in the statement's own transaction. So every writer of every release
 * moves them, a daemon of a release before these rows, a `squeal code`
 * gate with no daemon, or a transfer import alike. A random value, not a
 * counter: a store made again from nothing never repeats a value a reader
 * holds.
 *
 * A daemon of this release makes the triggers when it registers
 * (`ensureWriteMarkers`), with `IF NOT EXISTS`, outside `schema.ts` and
 * with no `user_version` raise: an older release opens the store as before
 * and its writes fire them. When it makes them it also sets each marker, so
 * the rows written before them count as a write. A reader trusts a marker
 * only while its table's triggers exist, read in the read transaction of
 * the marker and the rows (`statesMark`, `trustedClosureWrites`). A store
 * without them, a marker row that is missing (a removed worktree's, or one
 * with no write yet), or a store a test made without a connection: the
 * reader reads in full each time, as before. A change to a trigger's body
 * takes a new name, so a reader never trusts a body it does not know.
 */

/** The `meta` key of the closure marker, the store's: a closure is the repository's. */
export const CLOSURE_WRITES_KEY = "closure-writes";

/** The `meta` key of `worktreeId`'s states marker. */
export function statesMarkerMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("statesMarker", worktreeId);
}

const NEW_VALUE = "lower(hex(randomblob(8)))";

/** One statement that moves the marker named by the SQL expression `key`. */
const move = (key: string) =>
  `INSERT INTO meta (key, value) VALUES (${key}, ${NEW_VALUE})
     ON CONFLICT (key) DO UPDATE SET value = excluded.value;`;

const statesKey = (row: "NEW" | "OLD") =>
  `'${WORKTREE_META_ROWS.statesMarker.prefix}' || ${row}.worktree_id`;

type Marker = "states" | "closures";

interface Trigger {
  readonly name: string;
  readonly marker: Marker;
  readonly sql: string;
}

function triggersOf(table: string, marker: Marker): Trigger[] {
  const moves = (row: "NEW" | "OLD") =>
    marker === "states" ? move(statesKey(row)) : move(`'${CLOSURE_WRITES_KEY}'`);
  const on = {
    INSERT: moves("NEW"),
    UPDATE: `${moves("OLD")} ${moves("NEW")}`,
    DELETE: moves("OLD"),
  };
  return Object.entries(on).map(([event, body]) => {
    const name = `squeal_marker_${table}_${event.toLowerCase()}`;
    const sql = `CREATE TRIGGER IF NOT EXISTS ${name} AFTER ${event} ON ${table} BEGIN ${body} END`;
    return { name, marker, sql };
  });
}

const TRIGGERS: readonly Trigger[] = [
  ...triggersOf("known_states", "states"),
  ...triggersOf("test_file_keys", "states"),
  ...triggersOf("test_files", "closures"),
];

/** `store`'s connection, or `null` for a store not opened by `openStore` (a test's fake). */
function connectionIn(store: Store): Connection | null {
  try {
    return connectionOf(store);
  } catch {
    return null;
  }
}

/** The markers whose every trigger exists, read in the caller's transaction. */
function armed(conn: Connection): ReadonlySet<Marker> {
  const names = new Set(
    conn
      .all("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'squeal_marker_%'")
      .map((row) => String(row.name)),
  );
  const markers = new Set<Marker>(["states", "closures"]);
  for (const trigger of TRIGGERS) if (!names.has(trigger.name)) markers.delete(trigger.marker);
  return markers;
}

/**
 * Makes the triggers that are missing, and then sets every marker, in one
 * transaction; a store that has them all is left alone. A daemon of this
 * release calls it when it registers.
 */
export function ensureWriteMarkers(store: Store): void {
  const conn = connectionIn(store);
  if (conn === null || armed(conn).size === 2) return;
  conn.transaction(() => {
    for (const trigger of TRIGGERS) conn.db.exec(trigger.sql);
    // The rows written before the triggers count as a write.
    conn.run(
      `INSERT INTO meta (key, value)
         SELECT '${WORKTREE_META_ROWS.statesMarker.prefix}' || worktree_id, ${NEW_VALUE}
         FROM (SELECT worktree_id FROM known_states UNION SELECT worktree_id FROM test_file_keys)
         WHERE true
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    );
    conn.run(move("?"), CLOSURE_WRITES_KEY);
  });
}

/** The marker's value while its triggers exist and it has one; else `null`. */
function trusted(store: Store, marker: Marker, key: string): string | null {
  const conn = connectionIn(store);
  if (conn === null || !armed(conn).has(marker)) return null;
  return store.meta.get(key);
}

/**
 * `worktreeId`'s states marker as a reader may trust it; `null` reads in
 * full. Read it in the read transaction of the states and rows it keeps.
 */
export function statesMark(store: Store, worktreeId: WorktreeId): string | null {
  return trusted(store, "states", statesMarkerMetaKey(worktreeId));
}

/**
 * The closure marker as a reader may trust it; `null` reads in full. Read
 * it in the read transaction of the closures it keeps.
 */
export function trustedClosureWrites(store: Store): string | null {
  return trusted(store, "closures", CLOSURE_WRITES_KEY);
}
