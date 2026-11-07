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
 * - `import_targets`: a file's targets by its path and blob id, and by the
 *   project and environment hash its walk resolved in (review 0.1.415 B2):
 *   the importer's bytes alone do not fix what Vite resolves, an alias
 *   does too, and the environment hash holds the project's config. Shared
 *   by every worktree at those bytes in that resolution context. `static`
 *   and `dynamic` are JSON lists of project paths, sorted. Named apart from
 *   0.1.415's `import_edges`, which held no resolution context.
 * - `environment_inputs`: the files a project's environment hash was
 *   computed from, by project and hash, as JSON `[path, blob id or null]`
 *   pairs (`null` is a path with no file, a resolution candidate), and the
 *   roots its setup chains start at (review 0.1.415 B3): the config files,
 *   `setupFiles` and `globalSetup` entries, a JSON list. The edges of the
 *   config and setup walks are kept in `import_targets` under the same
 *   hash. Named apart from 0.1.415's `environment_files`, which held no
 *   roots.
 * - `worktree_environments`: the hash each worktree's daemon last read for
 *   each project.
 */
export const IMPORT_GRAPH_TABLES: Readonly<Record<string, string>> = {
  import_targets: `
CREATE TABLE import_targets (
  path TEXT NOT NULL,
  hash TEXT NOT NULL,
  project TEXT NOT NULL,
  environment TEXT NOT NULL,
  static TEXT NOT NULL,
  dynamic TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (path, hash, project, environment)
) STRICT, WITHOUT ROWID;
`,
  environment_inputs: `
CREATE TABLE environment_inputs (
  project TEXT NOT NULL,
  environment TEXT NOT NULL,
  files TEXT NOT NULL,
  roots TEXT NOT NULL,
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
  const byProject = new Map<ProjectName, FileImports[]>();
  for (const closure of fetched.closures ?? []) {
    const { project } = closure.testFile;
    const held = byProject.get(project) ?? [];
    held.push(...(closure.imports ?? []));
    byProject.set(project, held);
  }
  // Review 0.1.415 B3: the config and setup walks' edges, as the runner walked them.
  for (const { project, imports = [] } of fetched.environments ?? []) {
    byProject.set(project, [...(byProject.get(project) ?? []), ...imports]);
  }
  // An edge is kept in the resolution context it was walked in; a project with no hash yet keeps none.
  const walks = [...byProject].flatMap(([project, imports]) => {
    const environment = keys.index.environment(project);
    return environment === undefined || imports.length === 0
      ? []
      : [{ project, environment, imports }];
  });
  const environments = (fetched.environments ?? []).flatMap(({ project, roots }) => {
    const hash = keys.index.environment(project);
    const files = keys.environmentFiles(project);
    return hash === undefined ? [] : [{ project, hash, files, roots: roots ?? [] }];
  });
  if (walks.length === 0 && environments.length === 0) return;
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
    walks,
    environments,
  };
  conn.transaction(() => writeImportGraph(conn, write));
}

/** One project's walked files and the environment hash their imports were resolved under. */
export interface ImportWalk {
  readonly project: ProjectName;
  readonly environment: EnvironmentHash;
  readonly imports: readonly FileImports[];
}

/** What one daemon stores of a runner part's walk; `hashOf` is its stat cache's current blob id. */
export interface ImportGraphWrite {
  readonly root: AbsolutePath;
  readonly worktreeId: string;
  readonly now: EpochMs;
  readonly hashOf: (path: RelativePath) => FileHash | null | undefined;
  /** Each project's walked files, with the environment hash they were resolved under. */
  readonly walks: readonly ImportWalk[];
  /** Each project's environment hash and the files it was computed from, as just read. */
  readonly environments: readonly {
    readonly project: ProjectName;
    readonly hash: EnvironmentHash;
    readonly files: readonly RelativePath[];
    /** Where its setup chains start; empty when the runner gave none. */
    readonly roots: readonly RelativePath[];
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
  for (const walk of write.walks) {
    const seen = new Set<FileImports>();
    for (const file of walk.imports) {
      if (seen.has(file)) continue;
      seen.add(file);
      const blob = write.hashOf(file.path);
      if (typeof blob === "string") writeEdges(conn, write, walk, file, blob);
    }
  }
  for (const environment of write.environments) writeEnvironment(conn, write, environment);
}

function writeEdges(
  conn: Connection,
  write: ImportGraphWrite,
  { project, environment }: ImportWalk,
  file: FileImports,
  blob: FileHash,
): void {
  const targets = { static: JSON.stringify(file.static), dynamic: JSON.stringify(file.dynamic) };
  const held = conn.get(
    `SELECT static, dynamic FROM import_targets
     WHERE path = ? AND hash = ? AND project = ? AND environment = ?`,
    file.path,
    blob,
    project,
    environment,
  );
  const same =
    held !== null &&
    str(held, "static") === targets.static &&
    str(held, "dynamic") === targets.dynamic;
  if (same) return;
  if (!walkedBytesAre(join(write.root, file.path), file.sha1, blob)) return;
  conn.run(
    `INSERT INTO import_targets (path, hash, project, environment, static, dynamic, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (path, hash, project, environment) DO UPDATE SET
       static = excluded.static, dynamic = excluded.dynamic, recorded_at = excluded.recorded_at`,
    file.path,
    blob,
    project,
    environment,
    targets.static,
    targets.dynamic,
    write.now,
  );
  // A new version: the path's versions in this context that no worktree holds now go.
  if (held === null) {
    conn.run(
      `DELETE FROM import_targets
       WHERE path = ? AND project = ? AND environment = ? AND hash <> ? AND hash NOT IN (
         SELECT hash FROM file_hashes WHERE path = ? AND worktree_id IN (SELECT id FROM worktrees))`,
      file.path,
      project,
      environment,
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
    `INSERT INTO environment_inputs (project, environment, files, roots, recorded_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (project, environment) DO NOTHING`,
    project,
    hash,
    JSON.stringify(files),
    JSON.stringify(environment.roots),
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
  // The project's lists, and edges resolved in them, that no worktree reads now go.
  for (const table of ["environment_inputs", "import_targets"]) {
    conn.run(
      `DELETE FROM ${table} WHERE project = ? AND environment NOT IN (
         SELECT environment FROM worktree_environments WHERE project = ?)`,
      project,
      project,
    );
  }
}
