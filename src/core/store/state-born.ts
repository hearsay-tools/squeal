import type { Store } from "../types/store.js";
import { num } from "./codec.js";
import type { Connection } from "./connection.js";
import { connectionOf } from "./store.js";

/*
 * Row 005-105 (005 `research/consumer-view-design.md`, design N): every
 * known state has a birth mark, the id of its `state_born` row. The id is
 * `AUTOINCREMENT`, so it grows with each state made and a deleted id is
 * never used again. A consumer that keeps the store's high mark at its
 * registration can tell a check that existed then (a mark at or below it)
 * from one born after.
 *
 * The database keeps the marks, not the writers: an `AFTER INSERT` trigger
 * on `known_states` gives a new state its mark, and an `AFTER DELETE`
 * trigger removes it with the state. So every writer of every release keeps
 * them right, a daemon of a release before this row, a removed worktree's
 * prune or a transfer import alike. A retired check that comes back is a
 * new state and gets a new mark.
 *
 * The insert is not `INSERT OR IGNORE`: every writer of `known_states`
 * uses `INSERT OR REPLACE`, and a trigger's `OR IGNORE` takes the outer
 * statement's policy, so a rewrite would replace the mark. `WHERE NOT
 * EXISTS` inserts only for a state with no mark; `ON CONFLICT DO NOTHING`,
 * which keeps its own policy, is the guard. Alone it would keep the mark
 * too, but SQLite would draw an id for each rewrite and move the high mark
 * (005-105 notes: 32,000 a full rewrite); with the `WHERE` the high mark is
 * the newest state's. The REPLACE's own delete of the old row fires no
 * delete trigger while recursive triggers are off, SQLite's default, which
 * Squeal never changes.
 *
 * A daemon of this release makes the table and the triggers when it
 * registers (`ensureBirthMarks`), beside the write markers: `IF NOT
 * EXISTS`, outside `schema.ts`, with no `user_version` raise, and the marks
 * of the states that exist then in the same transaction. A reader trusts
 * the marks only while the table and both triggers exist
 * (`currentBirthMark`). A module of its own, outside the key-format
 * validity bundle (011 C3), like `view-seed.ts`: it decides nothing a check
 * stores. A change to a trigger's body takes a new name.
 */

const TABLE = `CREATE TABLE IF NOT EXISTS state_born (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worktree_id TEXT NOT NULL,
  check_id INTEGER NOT NULL,
  UNIQUE (worktree_id, check_id)
) STRICT`;

/** The triggers by name; both must exist for a reader to trust a mark. */
const TRIGGERS: Readonly<Record<string, string>> = {
  squeal_born_known_states_insert: `AFTER INSERT ON known_states BEGIN
    INSERT INTO state_born (worktree_id, check_id) SELECT NEW.worktree_id, NEW.check_id
      WHERE NOT EXISTS (SELECT 1 FROM state_born
        WHERE worktree_id = NEW.worktree_id AND check_id = NEW.check_id)
      ON CONFLICT DO NOTHING;
  END`,
  squeal_born_known_states_delete: `AFTER DELETE ON known_states BEGIN
    DELETE FROM state_born WHERE worktree_id = OLD.worktree_id AND check_id = OLD.check_id;
  END`,
};

/** `store`'s connection, or `null` for a store not opened by `openStore` (a test's fake). */
function connectionIn(store: Store): Connection | null {
  try {
    return connectionOf(store);
  } catch {
    return null;
  }
}

/** Whether the table and both triggers exist, read in the caller's transaction. */
function armed(conn: Connection): boolean {
  const names = new Set(
    conn
      .all(
        `SELECT name FROM sqlite_master WHERE (type = 'table' AND name = 'state_born')
           OR (type = 'trigger' AND name LIKE 'squeal_born_%')`,
      )
      .map((row) => String(row.name)),
  );
  return names.has("state_born") && Object.keys(TRIGGERS).every((name) => names.has(name));
}

/**
 * Makes the table and the triggers that are missing, then gives each known
 * state without a mark one and drops the marks of states that are gone, in
 * one transaction; a store that has them all is left alone. A daemon of
 * this release calls it when it registers.
 */
export function ensureBirthMarks(store: Store): void {
  const conn = connectionIn(store);
  if (conn === null || armed(conn)) return;
  conn.transaction(() => {
    conn.db.exec(TABLE);
    for (const [name, body] of Object.entries(TRIGGERS)) {
      conn.db.exec(`CREATE TRIGGER IF NOT EXISTS ${name} ${body}`);
    }
    // Only a store that lost a trigger has a mark of a state that is gone.
    conn.run(
      `DELETE FROM state_born WHERE NOT EXISTS (SELECT 1 FROM known_states s
         WHERE s.worktree_id = state_born.worktree_id AND s.check_id = state_born.check_id)`,
    );
    // The states written before the triggers, in one statement (`WHERE true`: SQLite's
    // upsert after a `SELECT` needs one to parse).
    conn.run(
      `INSERT INTO state_born (worktree_id, check_id)
         SELECT worktree_id, check_id FROM known_states WHERE true
       ON CONFLICT DO NOTHING`,
    );
  });
}

/**
 * The store's high mark: the largest birth mark ever given, `0` before the
 * first; the counter of `AUTOINCREMENT`, so a deleted newest mark still
 * counts. A state whose mark is at or below it existed when it was read.
 * `null` while the marks are not kept (no table or a trigger missing): a
 * reader then reads as before this row. Read it in the read transaction of
 * the states it is compared with.
 */
export function currentBirthMark(store: Store): number | null {
  const conn = connectionIn(store);
  if (conn === null || !armed(conn)) return null;
  const row = conn.get("SELECT seq FROM sqlite_sequence WHERE name = 'state_born'");
  return row === null ? 0 : num(row, "seq");
}
