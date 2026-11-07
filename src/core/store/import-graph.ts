import { lstatSync } from "node:fs";
import { join } from "node:path";
import { sameStat } from "../hash/stat-cache.js";
import type { RelativePath } from "../types/common.js";
import type { FileHash } from "../types/keys.js";
import type { Store } from "../types/store.js";
import type { FileStat } from "../types/watcher.js";
import { str } from "./codec.js";
import type { Connection } from "./connection.js";
import { hasImportGraphTables } from "./import-edges.js";
import { connectionOf } from "./store.js";

/**
 * Spec 015 D11: the import edges and environment files Squeal stored, as
 * one worktree reads them now. The contract `squeal reach` (row 015-109)
 * codes against.
 */
export interface ImportGraph {
  /** Direct targets of `path` at its current bytes in this worktree; undefined when not recorded at those bytes. */
  targets(
    path: RelativePath,
  ):
    | { readonly static: readonly RelativePath[]; readonly dynamic: readonly RelativePath[] }
    | undefined;
  /** The project's environment files for its current environment hash; undefined when not recorded. */
  environment(project: string): readonly RelativePath[] | undefined;
}

/**
 * Reads `worktreeId`'s view of the stored graph. Writes nothing. A path's
 * current bytes are its `file_hashes` blob id while the file on disk still
 * has the stat recorded with it; a file changed since the daemon last
 * looked has none. An environment list is current while each of its files is
 * at the blob id, or still absent, that its hash was computed from. A store
 * whose daemon never wrote the tables reads `undefined` throughout.
 */
export function readImportGraph(store: Store, root: string, worktreeId: string): ImportGraph {
  const conn = connectionOf(store);
  const tables = hasImportGraphTables(conn);
  const blobs = new Map<RelativePath, FileHash | null>();
  /** The blob id of `path`'s bytes now, `null` for no file, `undefined` when unknown. */
  const current = (path: RelativePath): FileHash | null | undefined => {
    if (blobs.has(path)) return blobs.get(path);
    const blob = currentBlob(store, root, worktreeId, path);
    if (blob !== undefined) blobs.set(path, blob);
    return blob;
  };
  return {
    targets: (path) => {
      const blob = tables ? current(path) : undefined;
      return typeof blob === "string" ? edgesAt(conn, path, blob) : undefined;
    },
    environment: (project) =>
      tables ? environmentOf(conn, worktreeId, project, current) : undefined,
  };
}

function currentBlob(
  store: Store,
  root: string,
  worktreeId: string,
  path: RelativePath,
): FileHash | null | undefined {
  const record = store.fileHashes.get(worktreeId, path);
  const stat = statOf(join(root, path));
  if (record === null) return stat === null ? null : undefined;
  return stat !== null && sameStat(stat, record) ? record.hash : undefined;
}

/** `lstat` of a regular file or symlink, as the stat cache takes it; `null` for anything else. */
function statOf(abs: string): FileStat | null {
  const stats = lstatSync(abs, { throwIfNoEntry: false });
  if (stats === undefined || (!stats.isFile() && !stats.isSymbolicLink())) return null;
  return { mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs, size: stats.size, inode: stats.ino };
}

function edgesAt(conn: Connection, path: RelativePath, blob: FileHash) {
  const row = conn.get(
    "SELECT static, dynamic FROM import_edges WHERE path = ? AND hash = ?",
    path,
    blob,
  );
  if (row === null) return undefined;
  return {
    static: JSON.parse(str(row, "static")) as RelativePath[],
    dynamic: JSON.parse(str(row, "dynamic")) as RelativePath[],
  };
}

function environmentOf(
  conn: Connection,
  worktreeId: string,
  project: string,
  current: (path: RelativePath) => FileHash | null | undefined,
): readonly RelativePath[] | undefined {
  const row = conn.get(
    `SELECT f.files FROM worktree_environments w
     JOIN environment_files f ON f.project = w.project AND f.environment = w.environment
     WHERE w.worktree_id = ? AND w.project = ?`,
    worktreeId,
    project,
  );
  if (row === null) return undefined;
  const files = JSON.parse(str(row, "files")) as [RelativePath, FileHash | null][];
  return files.every(([path, blob]) => current(path) === blob)
    ? files.map(([path]) => path)
    : undefined;
}
