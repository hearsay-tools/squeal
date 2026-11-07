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
  /**
   * Direct targets of `path` at its current bytes in this worktree, as a
   * walk of `project` resolved them in its current environment (review
   * 0.1.415 B2: an alias decides a target as much as the bytes do);
   * undefined when not recorded there.
   */
  targets(
    path: RelativePath,
    project: string,
  ):
    | { readonly static: readonly RelativePath[]; readonly dynamic: readonly RelativePath[] }
    | undefined;
  /**
   * The project's environment files for its current environment hash, and
   * the roots its setup chains start at (review 0.1.415 B3: the config
   * files, `setupFiles` and `globalSetup` entries); undefined when not
   * recorded.
   */
  environment(
    project: string,
  ):
    | { readonly files: readonly RelativePath[]; readonly roots: readonly RelativePath[] }
    | undefined;
}

/** A project's environment as this worktree reads it now. */
interface Current {
  readonly hash: string;
  readonly files: readonly RelativePath[];
  readonly roots: readonly RelativePath[];
}

/**
 * Reads `worktreeId`'s view of the stored graph. Writes nothing. A path's
 * current bytes are its `file_hashes` blob id while the file on disk still
 * has the stat recorded with it; a file changed since the daemon last
 * looked has none. An environment is current while each of its files is at
 * the blob id, or still absent, that its hash was computed from; edges are
 * read only in a project's current environment. A store whose daemon never
 * wrote the tables reads `undefined` throughout.
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
  const environments = new Map<string, Current | undefined>();
  const environment = (project: string): Current | undefined => {
    if (!tables) return undefined;
    if (!environments.has(project)) {
      environments.set(project, environmentOf(conn, worktreeId, project, current));
    }
    return environments.get(project);
  };
  return {
    targets: (path, project) => {
      const context = environment(project);
      const blob = context === undefined ? undefined : current(path);
      return context === undefined || typeof blob !== "string"
        ? undefined
        : edgesAt(conn, path, blob, project, context.hash);
    },
    environment: (project) => {
      const context = environment(project);
      return context === undefined ? undefined : { files: context.files, roots: context.roots };
    },
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

function edgesAt(
  conn: Connection,
  path: RelativePath,
  blob: FileHash,
  project: string,
  environment: string,
) {
  const row = conn.get(
    `SELECT static, dynamic FROM import_targets
     WHERE path = ? AND hash = ? AND project = ? AND environment = ?`,
    path,
    blob,
    project,
    environment,
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
): Current | undefined {
  const row = conn.get(
    `SELECT w.environment, f.files, f.roots FROM worktree_environments w
     JOIN environment_inputs f ON f.project = w.project AND f.environment = w.environment
     WHERE w.worktree_id = ? AND w.project = ?`,
    worktreeId,
    project,
  );
  if (row === null) return undefined;
  const files = JSON.parse(str(row, "files")) as [RelativePath, FileHash | null][];
  return files.every(([path, blob]) => current(path) === blob)
    ? {
        hash: str(row, "environment"),
        files: files.map(([path]) => path),
        roots: JSON.parse(str(row, "roots")) as RelativePath[],
      }
    : undefined;
}
