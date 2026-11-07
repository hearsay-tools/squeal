import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blobHash } from "../hash/blob.js";
import type { AbsolutePath, EpochMs, ProjectName, RelativePath } from "../types/common.js";
import type { EnvironmentHash, FileHash } from "../types/keys.js";
import type { FileImports, RunnerClosure, RunnerEnvironment } from "../types/runner.js";
import type { Store } from "../types/store.js";
import { str } from "./codec.js";
import type { Connection } from "./connection.js";
import { connectionOf } from "./store.js";

/*
 * Spec 015 D11, "New stored data": each walked file's direct import
 * targets, and each Vitest project's environment files. Additive main-store
 * tables, made by the first write when absent, with no `user_version`
 * raise: an older daemon's statements never name them, and no existing table
 * gains a column (the code store's `CODE_TABLES`, row 015-85). No key reads
 * them. They live outside `schema.ts`, which the key-format alarm bundles:
 * they decide nothing a check stores or accepts.
 *
 * - `import_edges`: a file's targets by the file's path and blob id, shared
 *   by every worktree at those bytes. `static` and `dynamic` are JSON lists
 *   of project paths, sorted.
 * - `environment_files`: the files a project's environment hash was computed
 *   from, by project and hash, as JSON `[path, blob id or null]` pairs; `null`
 *   is a path with no file (a resolution candidate).
 * - `worktree_environments`: the hash each worktree's daemon last read for
 *   each project.
 */
export const IMPORT_GRAPH_TABLES: Readonly<Record<string, string>> = {
  import_edges: `
CREATE TABLE import_edges (
  path TEXT NOT NULL,
  hash TEXT NOT NULL,
  static TEXT NOT NULL,
  dynamic TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (path, hash)
) STRICT, WITHOUT ROWID;
`,
  environment_files: `
CREATE TABLE environment_files (
  project TEXT NOT NULL,
  environment TEXT NOT NULL,
  files TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (project, environment)
) STRICT, WITHOUT ROWID;
`,
  worktree_environments: `
CREATE TABLE worktree_environments (
  worktree_id TEXT NOT NULL,
  project TEXT NOT NULL,
  environment TEXT NOT NULL,
  PRIMARY KEY (worktree_id, project)
) STRICT, WITHOUT ROWID;
`,
};

/** Whether `conn`'s database holds every `IMPORT_GRAPH_TABLES` table. */
export function hasImportGraphTables(conn: Connection): boolean {
  const found = conn.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (SELECT value FROM json_each(?))",
    JSON.stringify(Object.keys(IMPORT_GRAPH_TABLES)),
  );
  return found.length === Object.keys(IMPORT_GRAPH_TABLES).length;
}

/** Makes each absent `IMPORT_GRAPH_TABLES` table; called inside the writer's transaction. */
function ensureTables(conn: Connection): void {
  if (hasImportGraphTables(conn)) return;
  for (const [name, sql] of Object.entries(IMPORT_GRAPH_TABLES)) {
    if (conn.get("SELECT 1 AS found FROM sqlite_master WHERE name = ?", name) === null) {
      conn.db.exec(sql);
    }
  }
}

/** What a runner part fetched beside the closures it set: its runner closures and environments. */
export interface FetchedPart {
  readonly closures?: readonly RunnerClosure[];
  readonly environments?: readonly RunnerEnvironment[] | null;
}

/** What `recordImportGraph` reads of a scheduler's context, after the part's keys are set. */
export interface ImportGraphSource {
  readonly store: Store;
  readonly root: AbsolutePath;
  readonly worktreeId: string;
  readonly now: () => EpochMs;
  readonly keys: {
    readonly cache: { hashOf(path: RelativePath): FileHash | null | undefined };
    readonly index: { environment(project: ProjectName): EnvironmentHash | undefined };
    environmentFiles(project: ProjectName): readonly RelativePath[];
  };
}

/**
 * Spec 015 D11's stored data of `fetched`, from what the keys hold now: each
 * file's blob id from the stat cache, each environment's hash and files from
 * the read just set. In a transaction of its own, or a savepoint of the
 * caller's. A store not opened by `openStore` (a test's fake) stores none.
 */
export function recordImportGraph(source: ImportGraphSource, fetched: FetchedPart): void {
  const { keys } = source;
  const imports = (fetched.closures ?? []).flatMap((closure) => closure.imports ?? []);
  const environments = (fetched.environments ?? []).flatMap(({ project }) => {
    const hash = keys.index.environment(project);
    return hash === undefined ? [] : [{ project, hash, files: keys.environmentFiles(project) }];
  });
  if (imports.length === 0 && environments.length === 0) return;
  let conn: Connection;
  try {
    conn = connectionOf(source.store);
  } catch {
    return;
  }
  const write: ImportGraphWrite = {
    root: source.root,
    worktreeId: source.worktreeId,
    now: source.now(),
    hashOf: (path) => keys.cache.hashOf(path),
    imports,
    environments,
  };
  conn.transaction(() => writeImportGraph(conn, write));
}

/** What one daemon stores of a runner part's walk; `hashOf` is its stat cache's current blob id. */
export interface ImportGraphWrite {
  readonly root: AbsolutePath;
  readonly worktreeId: string;
  readonly now: EpochMs;
  readonly hashOf: (path: RelativePath) => FileHash | null | undefined;
  readonly imports: Iterable<FileImports>;
  /** Each project's environment hash and the files it was computed from, as just read. */
  readonly environments: readonly {
    readonly project: ProjectName;
    readonly hash: EnvironmentHash;
    readonly files: readonly RelativePath[];
  }[];
}

/**
 * Stores `write`'s edges and environment files; the caller holds the
 * transaction. A file's edges are stored under its stat cache blob id only
 * when its bytes on disk hash to the `sha1` the runner read and to that blob
 * id: the bytes walked are the bytes keyed. Otherwise nothing is stored for
 * it and its next walk tries again.
 */
export function writeImportGraph(conn: Connection, write: ImportGraphWrite): void {
  ensureTables(conn);
  const seen = new Set<FileImports>();
  for (const file of write.imports) {
    if (seen.has(file)) continue;
    seen.add(file);
    const blob = write.hashOf(file.path);
    if (typeof blob === "string") writeEdges(conn, write, file, blob);
  }
  for (const environment of write.environments) writeEnvironment(conn, write, environment);
}

function writeEdges(
  conn: Connection,
  write: ImportGraphWrite,
  file: FileImports,
  blob: FileHash,
): void {
  const targets = { static: JSON.stringify(file.static), dynamic: JSON.stringify(file.dynamic) };
  const held = conn.get(
    "SELECT static, dynamic FROM import_edges WHERE path = ? AND hash = ?",
    file.path,
    blob,
  );
  const same =
    held !== null &&
    str(held, "static") === targets.static &&
    str(held, "dynamic") === targets.dynamic;
  if (same) return;
  if (!walkedBytesAre(join(write.root, file.path), file.sha1, blob)) return;
  conn.run(
    `INSERT INTO import_edges (path, hash, static, dynamic, recorded_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (path, hash) DO UPDATE SET
       static = excluded.static, dynamic = excluded.dynamic, recorded_at = excluded.recorded_at`,
    file.path,
    blob,
    targets.static,
    targets.dynamic,
    write.now,
  );
  // A new version: the path's versions no worktree holds now go.
  if (held === null) {
    conn.run(
      `DELETE FROM import_edges WHERE path = ? AND hash <> ? AND hash NOT IN (
         SELECT hash FROM file_hashes WHERE path = ? AND worktree_id IN (SELECT id FROM worktrees))`,
      file.path,
      blob,
      file.path,
    );
  }
}

/**
 * Whether the file at `abs` holds the bytes the runner read (`sha1`) and the
 * stat cache keyed (`blob`). The object format is the blob id's: 64 hex
 * digits are SHA-256, else SHA-1.
 */
function walkedBytesAre(abs: AbsolutePath, sha1: string, blob: FileHash): boolean {
  let bytes: Buffer;
  try {
    bytes = readFileSync(abs);
  } catch {
    return false;
  }
  if (createHash("sha1").update(bytes).digest("hex") !== sha1) return false;
  return blobHash(bytes, blob.length === 64 ? "sha256" : "sha1") === blob;
}

function writeEnvironment(
  conn: Connection,
  write: ImportGraphWrite,
  environment: ImportGraphWrite["environments"][number],
): void {
  const { project, hash } = environment;
  const files = environment.files.map((path) => [path, write.hashOf(path) ?? null]);
  conn.run(
    `INSERT INTO environment_files (project, environment, files, recorded_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (project, environment) DO NOTHING`,
    project,
    hash,
    JSON.stringify(files),
    write.now,
  );
  const held = conn.get(
    "SELECT environment FROM worktree_environments WHERE worktree_id = ? AND project = ?",
    write.worktreeId,
    project,
  );
  if (held !== null && str(held, "environment") === hash) return;
  conn.run(
    `INSERT INTO worktree_environments (worktree_id, project, environment) VALUES (?, ?, ?)
     ON CONFLICT (worktree_id, project) DO UPDATE SET environment = excluded.environment`,
    write.worktreeId,
    project,
    hash,
  );
  // The project's lists no worktree reads now go.
  conn.run(
    `DELETE FROM environment_files WHERE project = ? AND environment NOT IN (
       SELECT environment FROM worktree_environments WHERE project = ?)`,
    project,
    project,
  );
}
