import { inflateRawSync } from "node:zlib";
import { testFileId } from "../keys/reverse-index.js";
import type { RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { Store } from "../types/store.js";
import { str } from "./codec.js";
import type { Connection, Row } from "./connection.js";
import { hasImportGraphTables } from "./import-edges.js";
import { connectionOf } from "./store.js";

/*
 * Spec 015 D11: the import edges Squeal stored, as one worktree reads them
 * now (review 0.1.415-r2, R2): only through a test file's current key in
 * this worktree, so a chain is exactly as valid as the file's result. The
 * contract `squeal reach` (row 015-109) codes against.
 */

/** One walk's direct imports, by importer. */
export type ImportMap = ReadonlyMap<
  RelativePath,
  { readonly static: readonly RelativePath[]; readonly dynamic: readonly RelativePath[] }
>;

/** A project's environment as a key row names it: its files, setup roots and walks. */
export interface EnvironmentWalk {
  readonly files: readonly RelativePath[];
  /** The config files, `setupFiles` and `globalSetup` entries the runner loads first. */
  readonly roots: readonly RelativePath[];
  /** The config, setup and global setup walks' imports. */
  readonly imports: ImportMap;
}

/** What a test file's current key was written with. */
export interface TestWalk {
  /** The closure walk's direct imports, by each project file it visited. */
  readonly imports: ImportMap;
  /** Its project's environment at the hash the key was keyed with; undefined when not recorded. */
  readonly environment: EnvironmentWalk | undefined;
}

export interface ImportGraph {
  /**
   * The walk written with `testFile`'s current key in this worktree;
   * undefined when the worktree has no key for it or none was written with
   * that key (a walk before this version, or not yet stored).
   */
  walk(testFile: TestFileRef): TestWalk | undefined;
}

/** Reads `worktreeId`'s view of the stored graph. Writes nothing. A store whose daemon never wrote the tables reads `undefined` throughout. */
export function readImportGraph(store: Store, worktreeId: string): ImportGraph {
  const conn = connectionOf(store);
  const tables = hasImportGraphTables(conn);
  const keys = new Map(
    store.testFileKeys.list(worktreeId).map((row) => [testFileId(row.testFile), row.key]),
  );
  const environments = new Map<string, EnvironmentWalk | undefined>();
  const environment = (project: string, hash: string) => {
    const id = `${project}\0${hash}`;
    if (!environments.has(id)) environments.set(id, environmentOf(conn, project, hash));
    return environments.get(id);
  };
  return {
    walk(testFile) {
      const key = keys.get(testFileId(testFile));
      if (!tables || key === null || key === undefined) return undefined;
      const row = conn.get(
        "SELECT environment, imports FROM test_file_imports WHERE project = ? AND path = ? AND key = ?",
        testFile.project,
        testFile.path,
        key,
      );
      if (row === null) return undefined;
      return {
        imports: decodeImports(row),
        environment: environment(testFile.project, str(row, "environment")),
      };
    },
  };
}

/** A stored walk's imports, by importer. */
function decodeImports(row: Row): ImportMap {
  const bytes = row.imports as Uint8Array;
  const entries = JSON.parse(inflateRawSync(bytes).toString("utf8")) as [
    RelativePath,
    RelativePath[],
    RelativePath[],
  ][];
  return new Map(entries.map(([path, s, d]) => [path, { static: s, dynamic: d }]));
}

function environmentOf(conn: Connection, project: string, hash: string) {
  const row = conn.get(
    "SELECT files, roots, imports FROM environment_walks WHERE project = ? AND environment = ?",
    project,
    hash,
  );
  if (row === null) return undefined;
  return {
    files: JSON.parse(str(row, "files")) as RelativePath[],
    roots: JSON.parse(str(row, "roots")) as RelativePath[],
    imports: decodeImports(row),
  };
}

/**
 * Row 015-117: every stored walk's test file and key, as
 * `project NUL path NUL key`; empty while the store has no walk table.
 */
export function storedWalkKeys(store: Store): ReadonlySet<string> {
  const conn = connectionOf(store);
  if (!hasImportGraphTables(conn)) return new Set();
  return new Set(
    conn
      .all("SELECT project, path, key FROM test_file_imports")
      .map((row) => `${str(row, "project")}\0${str(row, "path")}\0${str(row, "key")}`),
  );
}
