import { observedModulesMetaKey } from "../keys/modules.js";
import { addMissingEntries, observedDirectMetaKey, observedMetaKey } from "../keys/observed.js";
import { testFileId } from "../keys/reverse-index.js";
import { observedStartupMetaKey } from "../keys/startup.js";
import type { EpochMs, ProjectName, WorktreeId } from "../types/common.js";
import type { CheckKey } from "../types/keys.js";
import { importMark } from "../types/state.js";
import type { Store } from "../types/store.js";
import { location, num, oneOf, str } from "./codec.js";
import type { Connection } from "./connection.js";
import { connectionOf } from "./store.js";
import {
  type ExportedResult,
  type ExportedTestFile,
  OBSERVED_MAPS,
  type ObservedMap,
  observedHash,
  type ResultsBundle,
  staticListHash,
} from "./transfer-bundle.js";
import type { Rekeyed } from "./transfer-rekey.js";

/** An exported result as read, a failure still among them (018 D2). */
export interface ExportRow extends Omit<ExportedResult, "outcome"> {
  readonly outcome: "pass" | "fail" | "skip";
}

/**
 * Every stored result of `worktreeId`'s test files at their keys, pending or
 * not: one statement over `test_file_keys`, the `checks` index and the
 * `results` key.
 */
const AT_KEYS = `
  SELECT k.project, k.path, k.key, c.kind, c.full_name, r.outcome, r.duration_ms,
    r.location_path, r.location_line, r.location_column
  FROM test_file_keys k
  JOIN checks c ON c.project = k.project AND c.test_path = k.path
  JOIN results r ON r.check_id = c.id AND r.key = k.key
  WHERE k.worktree_id = ? AND k.key IS NOT NULL
  ORDER BY k.project, k.path, c.kind, c.full_name`;

export function exportedRows(conn: Connection, worktreeId: WorktreeId): ExportRow[] {
  return conn.all(AT_KEYS, worktreeId).map((row) => {
    const kind = oneOf(row, "kind", ["test", "file", "setup"] as const);
    return {
      project: str(row, "project"),
      testPath: str(row, "path"),
      kind,
      fullName: kind === "test" ? str(row, "full_name") : null,
      location: location(row),
      key: str(row, "key"),
      outcome: oneOf(row, "outcome", ["pass", "fail", "skip"] as const),
      durationMs: num(row, "duration_ms"),
    };
  });
}

/** Whether the store holds any result at `key` (018 D3: an import keeps them). */
export function holdsKey(conn: Connection, key: CheckKey): boolean {
  return conn.get("SELECT 1 AS found FROM results WHERE key = ? LIMIT 1", key) !== null;
}

/** `items` by `keyOf`, in first-seen order (`Map.groupBy`, which es2023 lacks). */
export function groupBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [item]);
    else group.push(item);
  }
  return groups;
}

/*
 * Spec 018 D3, D5: the rows an import adds, one slice's worth each
 * (`importSlices`, 021 D3); each runs inside its slice's transaction.
 */

const MAP_KEY: Readonly<Record<ObservedMap, (project: ProjectName) => string>> = {
  observed: observedMetaKey,
  observedDirect: observedDirectMetaKey,
  observedModules: observedModulesMetaKey,
};

/** The closure lists of `files` the store has none of. */
export function addClosures(
  store: Store,
  files: readonly ExportedTestFile[],
  importId: string,
  now: EpochMs,
): number {
  let closures = 0;
  for (const f of files) {
    const testFile = { project: f.project, path: f.path };
    if (
      f.closure !== null &&
      f.closure.method === METHOD &&
      store.testFiles.get(testFile) === null
    ) {
      store.testFiles.put({
        testFile,
        closure: { testFile, paths: f.closure.paths, complete: f.closure.complete, method: METHOD },
        updatedAt: now,
        updatedBy: importMark(importId),
      });
      closures++;
    }
  }
  return closures;
}

/** `project`'s observed entries the store has none of; how many of the `observed` map. */
export function addObserved(
  store: Store,
  project: ProjectName,
  files: readonly ExportedTestFile[],
): number {
  let observed = 0;
  for (const map of OBSERVED_MAPS) {
    const entries = Object.fromEntries(
      files.flatMap((f) => (f.observed[map] === undefined ? [] : [[f.path, f.observed[map]]])),
    );
    const added = addMissingEntries(store, MAP_KEY[map](project), entries);
    if (map === "observed") observed += added.length;
  }
  return observed;
}

/** The export's start-up lists the store has none of. */
export function addStartup(store: Store, bundle: ResultsBundle): number {
  let startup = 0;
  for (const s of bundle.observedStartup) {
    startup += addMissingEntries(
      store,
      observedStartupMetaKey(s.project),
      { "": s.paths },
      "list",
    ).length;
  }
  return startup;
}

/**
 * D5's row of each of `files`: the key its results went at, and the
 * environment, static list and observed entries that key was computed from,
 * here when re-keyed, else as the export held them.
 */
export function recordFiles(
  store: Store,
  bundle: ResultsBundle,
  files: readonly ExportedTestFile[],
  importId: string,
  rekeyed: ReadonlyMap<string, Rekeyed>,
): void {
  const conn = connectionOf(store);
  const hashes = new Map(bundle.environments.map((e) => [e.project, e.hash]));
  for (const f of files) {
    const here = rekeyed.get(testFileId(f));
    const [key, environment, closure, observed] =
      here === undefined
        ? [
            f.key,
            hashes.get(f.project) ?? "",
            f.closure === null ? "" : staticListHash(f.closure.paths, f.observed.observed),
            observedHash(f.observed),
          ]
        : [
            here.key,
            here.environment,
            staticListHash(here.closure, here.observed.observed),
            observedHash(here.observed),
          ];
    conn.run(
      `INSERT OR REPLACE INTO import_files (import_id, project, path, key, environment, closure, observed)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      importId,
      f.project,
      f.path,
      key,
      environment,
      closure,
      observed,
    );
  }
}

/** The one closure method a store reads (`test-files.ts`). */
const METHOD = "static imports plus declared inputs" as const;
