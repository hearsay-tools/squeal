import { json, num, oneOf, str } from "../../store/codec.js";
import type { Connection, Row } from "../../store/connection.js";
import type { CodeFile, CodeLanguage, FileCount } from "../../types/code.js";
import type { RelativePath, WorktreeId } from "../../types/index.js";
import type { CodeCountRepo, CodeFileRepo } from "./types.js";

export const LANGUAGES = [
  "typescript",
  "javascript",
  "python",
] as const satisfies readonly CodeLanguage[];

/** Spec 015 D4: a count depends on the bytes alone, so one row serves every worktree. */
export function createCountRepo(conn: Connection): CodeCountRepo {
  return {
    get(blob, language, counterVersion) {
      const row = conn.get(
        "SELECT * FROM counts WHERE blob = ? AND language = ? AND counter_version = ?",
        blob,
        language,
        counterVersion,
      );
      return row === null ? null : toCount(row);
    },
    put(count, at) {
      conn.run(
        `INSERT INTO counts (blob, language, counter_version, functions, errors, counted_at)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        count.blob,
        count.language,
        count.counterVersion,
        JSON.stringify(count.functions),
        JSON.stringify(count.errors),
        at,
      );
    },
  };
}

export function createFileRepo(conn: Connection): CodeFileRepo {
  return {
    list(worktreeId, paths) {
      const rows =
        paths === undefined
          ? conn.all("SELECT * FROM files WHERE worktree_id = ? ORDER BY path", worktreeId)
          : conn.all(
              `SELECT * FROM files WHERE worktree_id = ? AND path IN (SELECT value FROM json_each(?))
               ORDER BY path`,
              worktreeId,
              JSON.stringify(paths),
            );
      return rows.map(toFile);
    },
    uncounted(worktreeId) {
      return conn
        .all(
          `SELECT * FROM files f WHERE f.worktree_id = ? AND f.too_big = 0 AND NOT EXISTS (
             SELECT 1 FROM counts c WHERE c.blob = f.blob AND c.language = f.language
               AND c.counter_version = f.counter_version)
           ORDER BY f.path`,
          worktreeId,
        )
        .map(toFile);
    },
    upsertMany(worktreeId, files) {
      conn.transaction(() => {
        for (const file of files) {
          conn.run(
            `INSERT INTO files (worktree_id, path, blob, language, counter_version, size, revision,
               too_big) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (worktree_id, path) DO UPDATE SET blob = excluded.blob,
               language = excluded.language, counter_version = excluded.counter_version,
               size = excluded.size, revision = excluded.revision, too_big = excluded.too_big`,
            worktreeId,
            file.path,
            file.blob,
            file.language,
            file.counterVersion,
            file.size,
            file.revision,
            file.tooBig === true ? 1 : 0,
          );
        }
      });
    },
    removeMany(worktreeId: WorktreeId, paths: readonly RelativePath[]) {
      conn.run(
        "DELETE FROM files WHERE worktree_id = ? AND path IN (SELECT value FROM json_each(?))",
        worktreeId,
        JSON.stringify(paths),
      );
    },
  };
}

function toCount(row: Row): FileCount {
  return {
    blob: str(row, "blob"),
    language: oneOf(row, "language", LANGUAGES),
    counterVersion: num(row, "counter_version"),
    functions: json(row, "functions"),
    errors: json(row, "errors"),
  };
}

function toFile(row: Row): CodeFile {
  return {
    path: str(row, "path"),
    blob: str(row, "blob"),
    language: oneOf(row, "language", LANGUAGES),
    counterVersion: num(row, "counter_version"),
    size: num(row, "size"),
    revision: num(row, "revision"),
    ...(num(row, "too_big") === 1 ? { tooBig: true } : {}),
  };
}
