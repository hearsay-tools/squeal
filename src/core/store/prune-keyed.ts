import type { SQLInputValue } from "node:sqlite";
import type { Connection, Params } from "./connection.js";
import { DELETE_BATCH } from "./prune-rules.js";

/** One write transaction of a prune, or one read of its keys (spec 021 D3, row 021-33). */
type Slice = () => void;

/**
 * One rule of a prune, as `deleteByKey` runs it (row 021-33).
 *
 * `search` finds the rows to delete. It runs outside the write lock and may
 * scan a whole table. `recheck` is the same rule for one row, tested again
 * under the lock for each key read; it uses an index, never a scan, so a row
 * that stopped matching after the read stays. Without `recheck`, `search` is
 * tested again: it must then be a test of the row's own columns or by index.
 */
export interface KeyedRule {
  readonly table: string;
  /** The columns of the table's primary key, or of an index that names one row, in its order. */
  readonly key: readonly string[];
  readonly search: string;
  readonly searchParams?: Params;
  readonly recheck?: string;
  /** `recheck`'s parameters, read inside the write transaction; default `searchParams`. */
  readonly recheckParams?: () => Params;
  /** Keys per read and per delete; default `DELETE_BATCH`. */
  readonly batch?: number;
  /** Told how many rows each batch deleted. */
  readonly removed?: (n: number) => void;
}

/**
 * Row 021-33: deletes `rule`'s rows as slices. A read slice takes the next
 * `batch` keys `search` finds, after the last key read, in a read
 * transaction, which in WAL takes no write lock; a delete slice then deletes
 * those keys that `recheck` still matches, in one write transaction. A read
 * that finds nothing ends the rule: a prune with nothing to delete takes no
 * write lock. Key columns hold text or numbers, never blobs (the keys travel
 * as JSON).
 */
export function* deleteByKey(conn: Connection, rule: KeyedRule): Generator<Slice, void, undefined> {
  const batch = rule.batch ?? DELETE_BATCH;
  const columns = rule.key.join(", ");
  const after = rule.key.map(() => "?").join(", ");
  const read = (from: boolean) =>
    `SELECT ${columns} FROM ${rule.table}
     WHERE ${from ? `(${columns}) > (${after}) AND ` : ""}(${rule.search})
     ORDER BY ${columns} LIMIT ${batch}`;
  const first = read(false);
  const next = read(true);
  const named = rule.key.map((_, i) => `value ->> ${i}`).join(", ");
  const remove = `DELETE FROM ${rule.table}
    WHERE (${columns}) IN (SELECT ${named} FROM json_each(?)) AND (${rule.recheck ?? rule.search})`;
  const searchParams = rule.searchParams ?? [];
  let last: SQLInputValue[] | null = null;
  for (;;) {
    let keys: SQLInputValue[][] = [];
    yield () => {
      const rows = conn.read(() =>
        last === null ? conn.all(first, ...searchParams) : conn.all(next, ...last, ...searchParams),
      );
      keys = rows.map((row) => rule.key.map((column) => row[column] as SQLInputValue));
    };
    if (keys.length === 0) return;
    const list = JSON.stringify(keys);
    yield () => {
      const n = conn.transaction(() =>
        conn.run(remove, list, ...(rule.recheckParams?.() ?? searchParams)),
      );
      rule.removed?.(n);
    };
    if (keys.length < batch) return;
    last = keys[keys.length - 1] ?? null;
  }
}

/**
 * Each worktree id `table` holds, one search of its first key column per id
 * instead of a read of every row (row 011-315: on cezar's code store, 24 ids
 * over 2.8 M state rows, 0.1 k page reads against 68 k).
 */
export const worktreeIdsOf = (table: string): string => `WITH RECURSIVE ids(id) AS (
    SELECT min(worktree_id) FROM ${table}
    UNION ALL SELECT (SELECT min(worktree_id) FROM ${table} WHERE worktree_id > ids.id)
      FROM ids WHERE ids.id IS NOT NULL)
  SELECT id FROM ids WHERE id IS NOT NULL`;

/**
 * `worktreeIdsOf(table)` as a JSON list, the parameter of a recheck that
 * searches `table` by worktree id and check id: its index leads with the
 * worktree id, so each id is one search (row 021-33).
 */
export function worktreeIdList(conn: Connection, table: string): string {
  return JSON.stringify(conn.all(worktreeIdsOf(table)).map((row) => row.id));
}
