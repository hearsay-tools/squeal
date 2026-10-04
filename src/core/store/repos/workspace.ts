import type {
  FileChange,
  FileHashRecord,
  FileHashRepo,
  Revision,
  RevisionRepo,
} from "../../types/index.js";
import { bool, flag, json, num, oneOf, str, strOrNull } from "../codec.js";
import type { Connection, Row } from "../connection.js";

const TRIGGERS = ["watch", "interval", "start", "dropped-events"] as const;

export function createRevisionRepo(conn: Connection): RevisionRepo {
  return {
    append: (revision) =>
      conn.transaction(() => {
        // Under the write lock, so two writers cannot take the same number.
        const row = conn.get(
          "SELECT coalesce(max(number), 0) AS n FROM revisions WHERE worktree_id = ?",
          revision.worktreeId,
        );
        const stored: Revision = { ...revision, number: (row === null ? 0 : num(row, "n")) + 1 };
        conn.run(
          `INSERT INTO revisions (worktree_id, number, created_at, head, dirty, trigger, changes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          stored.worktreeId,
          stored.number,
          stored.createdAt,
          stored.head,
          flag(stored.dirty),
          stored.trigger,
          JSON.stringify(stored.changes),
        );
        return stored;
      }),
    latest: (worktreeId) => {
      const row = conn.get(
        "SELECT * FROM revisions WHERE worktree_id = ? ORDER BY number DESC LIMIT 1",
        worktreeId,
      );
      return row === null ? null : toRevision(row);
    },
    get: (worktreeId, number) => {
      const row = conn.get(
        "SELECT * FROM revisions WHERE worktree_id = ? AND number = ?",
        worktreeId,
        number,
      );
      return row === null ? null : toRevision(row);
    },
  };
}

function toRevision(row: Row): Revision {
  return {
    worktreeId: str(row, "worktree_id"),
    number: num(row, "number"),
    createdAt: num(row, "created_at"),
    head: strOrNull(row, "head"),
    dirty: bool(row, "dirty"),
    trigger: oneOf(row, "trigger", TRIGGERS),
    changes: json<FileChange[]>(row, "changes"),
  };
}

export function createFileHashRepo(conn: Connection): FileHashRepo {
  return {
    get: (worktreeId, path) => {
      const row = conn.get(
        "SELECT * FROM file_hashes WHERE worktree_id = ? AND path = ?",
        worktreeId,
        path,
      );
      return row === null ? null : toFileHash(row);
    },
    list: (worktreeId) =>
      conn
        .all("SELECT * FROM file_hashes WHERE worktree_id = ? ORDER BY path", worktreeId)
        .map(toFileHash),
    upsertMany: (worktreeId, records) =>
      conn.transaction(() => {
        for (const r of records) {
          conn.run(
            `INSERT OR REPLACE INTO file_hashes
               (worktree_id, path, mtime_ms, ctime_ms, size, inode, hash)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            worktreeId,
            r.path,
            r.mtimeMs,
            r.ctimeMs,
            r.size,
            r.inode,
            r.hash,
          );
        }
      }),
    removeMany: (worktreeId, paths) =>
      conn.transaction(() => {
        for (const path of paths) {
          conn.run("DELETE FROM file_hashes WHERE worktree_id = ? AND path = ?", worktreeId, path);
        }
      }),
  };
}

function toFileHash(row: Row): FileHashRecord {
  return {
    path: str(row, "path"),
    mtimeMs: num(row, "mtime_ms"),
    ctimeMs: num(row, "ctime_ms"),
    size: num(row, "size"),
    inode: num(row, "inode"),
    hash: str(row, "hash"),
  };
}
