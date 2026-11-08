import { compare } from "../fs/compare.js";
import { KEY_FORMAT_VERSION } from "../keys/key-format.js";
import { observedModulesMetaKey } from "../keys/modules.js";
import {
  addMissingEntries,
  observedDirectMetaKey,
  observedMetaKey,
  readSharedEntries,
} from "../keys/observed.js";
import { observedStartupMetaKey } from "../keys/startup.js";
import type { CheckId } from "../types/check.js";
import type { EpochMs, ProjectName, RelativePath, WorktreeId } from "../types/common.js";
import type { CheckKey, TestFileRef } from "../types/keys.js";
import { importMark } from "../types/state.js";
import type { Store } from "../types/store.js";
import type { ResultRecord } from "../types/store-records.js";
import { putEnvironments, worktreeEnvironments } from "./environments.js";
import { type ExportHeader, ensureImportTables } from "./imports.js";
import { connectionOf, readTransaction } from "./store.js";
import {
  absolutePathIn,
  type ExportedResult,
  type ExportedTestFile,
  listHash,
  OBSERVED_MAPS,
  type ObservedMap,
  observedHash,
  RESULTS_FORMAT,
  type ResultsBundle,
} from "./transfer-bundle.js";
import { exportedRows, groupBy, holdsKey } from "./transfer-rows.js";

const MAP_KEY: Readonly<Record<ObservedMap, (project: ProjectName) => string>> = {
  observed: observedMetaKey,
  observedDirect: observedDirectMetaKey,
  observedModules: observedModulesMetaKey,
};

/** What an export held and left out (018 D2). */
export interface ExportCounts {
  /** The worktree's test files with a key. */
  readonly keyed: number;
  readonly testFiles: number;
  readonly results: number;
  /** Files left out: no key, or a pending one. */
  readonly noKey: number;
  /** Files left out: a key with no stored result. */
  readonly noResult: number;
  /** Files left out: a failure at the key. */
  readonly failed: number;
}

/** A path an export would write that is not relative to the worktree (018 D2). */
export class AbsolutePathError extends Error {
  constructor(readonly path: string) {
    super(`squeal export: refuses to write an absolute path: ${path}`);
  }
}

/**
 * Spec 018 D2: the passes and skips of `worktreeId`'s test files at their
 * keys, with the closure lists, observed entries and environments a fresh
 * store needs to compute the same keys. A file with a failure at its key is
 * left out whole; one with no key, a pending key or no result at it too.
 * Reads only. Throws `AbsolutePathError` before returning a bundle that would
 * hold an absolute path.
 */
export function exportResults(
  store: Store,
  worktreeId: WorktreeId,
  header: ExportHeader,
): { readonly bundle: ResultsBundle; readonly counts: ExportCounts } {
  // One read transaction: a daemon's commit between the reads never mixes two states.
  return readTransaction(store, () => exportOf(store, worktreeId, header));
}

function exportOf(
  store: Store,
  worktreeId: WorktreeId,
  header: ExportHeader,
): { readonly bundle: ResultsBundle; readonly counts: ExportCounts } {
  const keys = store.testFileKeys.list(worktreeId);
  const rows = exportedRows(connectionOf(store), worktreeId);
  const byFile = groupBy(rows, (r) => `${r.project}\0${r.testPath}`);
  const files: ExportedTestFile[] = [];
  const results: ExportedResult[] = [];
  let noKey = 0;
  let noResult = 0;
  let failed = 0;
  for (const k of keys) {
    if (k.key === null || k.pending !== null) {
      noKey++;
      continue;
    }
    const held = byFile.get(`${k.testFile.project}\0${k.testFile.path}`) ?? [];
    if (held.length === 0) noResult++;
    else if (held.some((r) => r.outcome === "fail")) failed++;
    else {
      files.push(exportedFile(store, k.testFile, k.key));
      for (const r of held) results.push({ ...r, outcome: r.outcome === "skip" ? "skip" : "pass" });
    }
  }
  const projects = new Set(files.map((f) => f.project));
  const bundle: ResultsBundle = {
    format: RESULTS_FORMAT,
    header,
    environments: worktreeEnvironments(store, worktreeId)
      .filter((e) => projects.has(e.project))
      .map(({ project, hash, descriptor }) => ({ project, hash, descriptor })),
    testFiles: files,
    observedStartup: [...projects].sort(compare).flatMap((project) => {
      const paths = readSharedEntries(store, observedStartupMetaKey(project), "list")[""];
      return paths === undefined ? [] : [{ project, paths }];
    }),
    results,
  };
  const absolute = absolutePathIn(bundle);
  if (absolute !== null) throw new AbsolutePathError(absolute);
  const counts = { keyed: keys.length - noKey, testFiles: files.length, results: results.length };
  return { bundle, counts: { ...counts, noKey, noResult, failed } };
}

function exportedFile(store: Store, testFile: TestFileRef, key: CheckKey): ExportedTestFile {
  const record = store.testFiles.get(testFile);
  const observed: { -readonly [M in ObservedMap]?: readonly RelativePath[] } = {};
  for (const map of OBSERVED_MAPS) {
    const entry = readSharedEntries(store, MAP_KEY[map](testFile.project))[testFile.path];
    if (entry !== undefined) observed[map] = entry;
  }
  const closure =
    record === null
      ? null
      : {
          paths: record.closure.paths,
          complete: record.closure.complete,
          method: record.closure.method,
        };
  return { ...testFile, key, closure, observed };
}

/**
 * Spec 018 D3: why this Squeal refuses `bundle`, naming both key formats, or
 * `null`. A result at another format's key could never be current here.
 */
export function importRefusal(bundle: ResultsBundle): string | null {
  const theirs = bundle.header.keyFormat;
  if (theirs === KEY_FORMAT_VERSION) return null;
  return `the export's key format is ${theirs}; this Squeal's is ${KEY_FORMAT_VERSION}`;
}

/** What an import added (018 D3). */
export interface ImportCounts {
  readonly results: number;
  /** Results left as they were: the store held results at their key already. */
  readonly alreadyStored: number;
  readonly closures: number;
  readonly observed: number;
  readonly startup: number;
}

/** A dry run's way out of its transaction. */
class DryRun extends Error {
  constructor(readonly counts: ImportCounts) {
    super("dry run");
  }
}

/**
 * Spec 018 D3: adds `bundle` to the store in one transaction: the import's
 * rows, each result at its exported key with the import as its provenance
 * and `now` as its record time, so running daemons read the keys as new
 * (`StoredKeys`); closure lists and observed entries only where the store has
 * none; the environment descriptors. A key the store holds results at keeps
 * them. With `dryRun` the transaction rolls back and the counts stay.
 */
export function importResults(
  store: Store,
  bundle: ResultsBundle,
  options: {
    readonly importId: string;
    readonly fileHash: string;
    readonly now: EpochMs;
    readonly dryRun?: boolean;
  },
): ImportCounts {
  const conn = connectionOf(store);
  const { importId, now } = options;
  try {
    return conn.transaction(() => {
      ensureImportTables(conn);
      conn.run(
        `INSERT INTO imports (id, header, file_hash, imported_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
        importId,
        JSON.stringify(bundle.header),
        options.fileHash,
        now,
      );
      const counts = {
        ...addResults(store, bundle, importId, now),
        ...addLists(store, bundle, importId, now),
      };
      putEnvironments(
        store,
        bundle.environments.flatMap(({ hash, descriptor }) =>
          descriptor === null ? [] : [{ hash, descriptor }],
        ),
        now,
      );
      if (options.dryRun === true) throw new DryRun(counts);
      return counts;
    });
  } catch (error) {
    if (error instanceof DryRun) return error.counts;
    throw error;
  }
}

function addResults(
  store: Store,
  bundle: ResultsBundle,
  importId: string,
  now: EpochMs,
): Pick<ImportCounts, "results" | "alreadyStored"> {
  const conn = connectionOf(store);
  const held = new Map<CheckKey, boolean>();
  const records: ResultRecord[] = [];
  let alreadyStored = 0;
  for (const r of bundle.results) {
    const stored = held.get(r.key) ?? holdsKey(conn, r.key);
    held.set(r.key, stored);
    if (stored) {
      alreadyStored++;
      continue;
    }
    const check: CheckId =
      r.kind === "test"
        ? { kind: "test", project: r.project, testPath: r.testPath, fullName: r.fullName ?? "" }
        : { kind: r.kind, project: r.project, testPath: r.testPath };
    records.push({
      check,
      key: r.key,
      outcome: r.outcome,
      durationMs: r.durationMs,
      location: r.location,
      fingerprint: null,
      summary: null,
      errors: [],
      provenance: {
        worktreeId: importMark(importId),
        revision: 0,
        commit: bundle.header.commit,
        dirty: bundle.header.dirty,
        runId: importMark(importId),
        recordedAt: now,
      },
    });
  }
  store.results.putMany(records);
  return { results: records.length, alreadyStored };
}

function addLists(
  store: Store,
  bundle: ResultsBundle,
  importId: string,
  now: EpochMs,
): Pick<ImportCounts, "closures" | "observed" | "startup"> {
  const conn = connectionOf(store);
  const hashes = new Map(bundle.environments.map((e) => [e.project, e.hash]));
  let closures = 0;
  let observed = 0;
  let startup = 0;
  for (const f of bundle.testFiles) {
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
    conn.run(
      `INSERT OR REPLACE INTO import_files (import_id, project, path, key, environment, closure, observed)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      importId,
      f.project,
      f.path,
      f.key,
      hashes.get(f.project) ?? "",
      f.closure === null ? "" : listHash(f.closure.paths),
      observedHash(f.observed),
    );
  }
  for (const [project, files] of groupBy(bundle.testFiles, (f) => f.project)) {
    for (const map of OBSERVED_MAPS) {
      const entries = Object.fromEntries(
        files.flatMap((f) => (f.observed[map] === undefined ? [] : [[f.path, f.observed[map]]])),
      );
      const added = addMissingEntries(store, MAP_KEY[map](project), entries);
      if (map === "observed") observed += added.length;
    }
  }
  for (const s of bundle.observedStartup) {
    startup += addMissingEntries(
      store,
      observedStartupMetaKey(s.project),
      { "": s.paths },
      "list",
    ).length;
  }
  return { closures, observed, startup };
}

/** The one closure method a store reads (`test-files.ts`). */
const METHOD = "static imports plus declared inputs" as const;
