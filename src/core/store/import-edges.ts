import { deflateRawSync } from "node:zlib";
import type { EpochMs, ProjectName, RelativePath } from "../types/common.js";
import type { CheckKey, EnvironmentHash, TestFileRef } from "../types/keys.js";
import type { FileImports, RunnerClosure, RunnerEnvironment } from "../types/runner.js";
import type { Store } from "../types/store.js";
import type { Connection } from "./connection.js";
import { connectionOf } from "./store.js";

/*
 * Spec 015 D11, "New stored data", under one rule (review 0.1.415-r2, R2):
 * stored import edges belong to a test file's result key. They are written
 * with the closure the daemon keyed, and read only while that key is the
 * worktree's current key for the file, the rule `closureTrust` reads
 * closures by. Nothing else (a path, a blob, a project, an environment)
 * selects a variant, and no edge is checked on its own: the key covers the
 * closure's paths and bytes and the environment, so an edge is exactly as
 * valid as the result. Additive main-store tables, made by the first write,
 * with no `user_version` raise; no key reads them, so they live outside
 * `schema.ts`, which the key-format alarm bundles.
 *
 * - `test_file_imports`: by test file and key, the closure walk's direct
 *   imports, a deflated JSON list of `[path, static, dynamic]`, and the
 *   environment hash the key was keyed with.
 * - `environment_walks`: by project and environment hash, the config, setup
 *   and global setup walks' imports, the environment's files and the roots
 *   its setup chains start at. Read only through a key row that names the
 *   hash, so a setup chain is as valid as the result too.
 *
 * Names apart from 0.1.415's `import_edges`, `import_targets`,
 * `environment_files`, `environment_inputs` and `worktree_environments`.
 */
export const IMPORT_GRAPH_TABLES: Readonly<Record<string, string>> = {
  test_file_imports: `
CREATE TABLE test_file_imports (
  project TEXT NOT NULL,
  path TEXT NOT NULL,
  key TEXT NOT NULL,
  environment TEXT NOT NULL,
  imports BLOB NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (project, path, key)
) STRICT, WITHOUT ROWID;
`,
  environment_walks: `
CREATE TABLE environment_walks (
  project TEXT NOT NULL,
  environment TEXT NOT NULL,
  files TEXT NOT NULL,
  roots TEXT NOT NULL,
  imports BLOB NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (project, environment)
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

/** One walk's direct imports as stored: deflated JSON of `[path, static, dynamic]`, by path. */
export function encodeImports(imports: readonly FileImports[]): Uint8Array {
  const entries = new Map(imports.map((f) => [f.path, [f.path, f.static, f.dynamic] as const]));
  return deflateRawSync(JSON.stringify([...entries.values()]));
}

/** What a runner part fetched beside the closures it set: its runner closures and environments. */
export interface FetchedPart {
  readonly closures?: readonly RunnerClosure[];
  readonly environments?: readonly RunnerEnvironment[] | null;
}

/** What `recordImportGraph` reads of a scheduler's context, after the part's keys are set. */
export interface ImportGraphSource {
  readonly store: Store;
  readonly now: () => EpochMs;
  readonly keys: {
    readonly index: {
      environment(project: ProjectName): EnvironmentHash | undefined;
      key(testFile: TestFileRef): CheckKey | null;
    };
    environmentFiles(project: ProjectName): readonly RelativePath[];
  };
}

/**
 * Spec 015 D11's stored data of `fetched`, by the keys the part just set:
 * each closure's walk under its test file's key, each environment's walks
 * under its hash. In a transaction of its own, or a savepoint of the
 * caller's. A store not opened by `openStore` (a test's fake) stores none.
 */
export function recordImportGraph(source: ImportGraphSource, fetched: FetchedPart): void {
  const { keys } = source;
  const walks = (fetched.closures ?? []).flatMap((closure) => {
    const key = keys.index.key(closure.testFile);
    const environment = keys.index.environment(closure.testFile.project);
    return key === null || environment === undefined || closure.imports === undefined
      ? []
      : [{ testFile: closure.testFile, key, environment, imports: closure.imports }];
  });
  const environments = (fetched.environments ?? []).flatMap(({ project, roots, imports }) => {
    const hash = keys.index.environment(project);
    const files = keys.environmentFiles(project);
    return hash === undefined
      ? []
      : [{ project, hash, files, roots: roots ?? [], imports: imports ?? [] }];
  });
  if (walks.length === 0 && environments.length === 0) return;
  let conn: Connection;
  try {
    conn = connectionOf(source.store);
  } catch {
    return;
  }
  const write: ImportGraphWrite = { now: source.now(), walks, environments };
  conn.transaction(() => writeImportGraph(conn, write));
}

/** A closure's walk, under the key its test file was keyed with. */
export interface KeyedWalk {
  readonly testFile: TestFileRef;
  readonly key: CheckKey;
  readonly environment: EnvironmentHash;
  readonly imports: readonly FileImports[];
}

/** One daemon's writes of a runner part. */
export interface ImportGraphWrite {
  readonly now: EpochMs;
  readonly walks: readonly KeyedWalk[];
  /** Each project's environment, its walks, files and roots, under the hash just read. */
  readonly environments: readonly {
    readonly project: ProjectName;
    readonly hash: EnvironmentHash;
    readonly files: readonly RelativePath[];
    readonly roots: readonly RelativePath[];
    readonly imports: readonly FileImports[];
  }[];
}

/**
 * Stores `write`; the caller holds the transaction. One key's walk is one
 * walk, so a row stays as first written; a test file's rows at keys no
 * worktree holds now go, and so do the environment walks no row names
 * and no project reads now.
 */
export function writeImportGraph(conn: Connection, write: ImportGraphWrite): void {
  ensureTables(conn);
  for (const env of write.environments) {
    conn.run(
      `INSERT INTO environment_walks (project, environment, files, roots, imports, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (project, environment) DO NOTHING`,
      env.project,
      env.hash,
      JSON.stringify(env.files),
      JSON.stringify(env.roots),
      encodeImports(env.imports),
      write.now,
    );
  }
  for (const walk of write.walks) {
    const { project, path } = walk.testFile;
    conn.run(
      `INSERT INTO test_file_imports (project, path, key, environment, imports, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (project, path, key) DO NOTHING`,
      project,
      path,
      walk.key,
      walk.environment,
      encodeImports(walk.imports),
      write.now,
    );
    conn.run(
      `DELETE FROM test_file_imports WHERE project = ? AND path = ? AND key <> ? AND key NOT IN (
         SELECT key FROM test_file_keys
         WHERE project = ? AND path = ? AND key IS NOT NULL
           AND worktree_id IN (SELECT id FROM worktrees))`,
      project,
      path,
      walk.key,
      project,
      path,
    );
  }
  const read = new Set(write.environments.map((env) => `${env.project}\0${env.hash}`));
  const projects = new Set([
    ...write.walks.map((w) => w.testFile.project),
    ...write.environments.map((e) => e.project),
  ]);
  for (const project of projects) {
    for (const row of conn.all(
      `SELECT environment FROM environment_walks WHERE project = ? AND environment NOT IN (
         SELECT environment FROM test_file_imports WHERE project = ?)`,
      project,
      project,
    )) {
      const environment = String(row.environment);
      if (read.has(`${project}\0${environment}`)) continue;
      conn.run(
        "DELETE FROM environment_walks WHERE project = ? AND environment = ?",
        project,
        environment,
      );
    }
  }
}
