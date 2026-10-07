import { DatabaseSync } from "node:sqlite";
import { appendNote, withNote } from "../notes.js";
import { storePaths } from "../store/index.js";
import {
  type AbsolutePath,
  type DaemonNote,
  notesMetaKey,
  type Store,
  type WorktreeId,
} from "../types/index.js";

/** Persists a note for status; a store that cannot take it costs only the log line. */
export function writeNote(
  store: Store,
  worktreeId: WorktreeId,
  note: DaemonNote,
  log: (line: string) => void,
): void {
  try {
    appendNote(store, worktreeId, note);
  } catch (error) {
    log(`could not persist a note (${note.text}): ${String(error)}`);
  }
}

/**
 * Leaves a note in a store whose schema is newer than this Squeal, which
 * `openStore` refuses to open. Spec 001 D8: "A daemon that finds a
 * `user_version` newer than it understands exits and leaves a status entry
 * saying so." Writes only the `meta` key-value row the notes live in, and
 * only when a `meta(key, value)` table exists; returns whether it did.
 */
export function noteInNewerStore(
  commonDir: AbsolutePath,
  worktreeId: WorktreeId,
  note: DaemonNote,
): boolean {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(storePaths(commonDir).database);
    db.exec("PRAGMA busy_timeout = 2000");
    const columns = db.prepare("SELECT name FROM pragma_table_info('meta')").all();
    const names = new Set(columns.map((c) => String(c.name)));
    if (!names.has("key") || !names.has("value")) return false;
    const key = notesMetaKey(worktreeId);
    db.exec("BEGIN IMMEDIATE");
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
    const notes = withNote(row?.value, note);
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
      key,
      JSON.stringify(notes),
    );
    db.exec("COMMIT");
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}
