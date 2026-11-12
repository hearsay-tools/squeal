import { observedModulesMetaKey } from "../keys/modules.js";
import { addMissingEntries, observedDirectMetaKey, observedMetaKey } from "../keys/observed.js";
import { testFileId } from "../keys/reverse-index.js";
import { observedStartupMetaKey } from "../keys/startup.js";
import type { CheckId } from "../types/check.js";
import type { EpochMs, ProjectName } from "../types/common.js";
import type { ImportCounts } from "../types/daemon-writes.js";
import type { CheckKey } from "../types/keys.js";
import { importMark } from "../types/state.js";
import type { Store } from "../types/store.js";
import type { ResultRecord } from "../types/store-records.js";
import { putEnvironments } from "./environments.js";
import { ensureImportTables } from "./imports.js";
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
import { type Rekeyed, type Rekeying, rekeyFiles } from "./transfer-rekey.js";
import { groupBy, holdsKey } from "./transfer-rows.js";

/*
 * Spec 021 D3 (row 021-20): an import as slices, each one short write
 * transaction, so its driver leaves the store's write lock free between
 * them and tries a busy slice again on its own (`importSliced`), in place
 * of one transaction over the whole bundle.
 */

/** Results one slice adds at most; the results at one key stay in one slice. */
export const IMPORT_SLICE_RESULTS = 2_000;
/** Test files whose closure lists or import rows one slice adds at most. */
export const IMPORT_SLICE_FILES = 500;

const MAP_KEY: Readonly<Record<ObservedMap, (project: ProjectName) => string>> = {
  observed: observedMetaKey,
  observedDirect: observedDirectMetaKey,
  observedModules: observedModulesMetaKey,
};

/** How an import writes (018 D3, D11; 021 D3). */
export interface ImportOptions {
  readonly importId: string;
  readonly fileHash: string;
  /** The import's time: its record, its closure lists, its environments. */
  readonly now: EpochMs;
  /**
   * Each results slice's record time, read inside its transaction, so a
   * daemon's read of the keys recorded since its last one (`StoredKeys`)
   * finds a slice that committed late. Absent: `now`.
   */
  readonly clock?: () => EpochMs;
  readonly dryRun?: boolean;
  readonly rekeying?: Rekeying;
}

/** One write transaction of an import. */
export interface ImportSlice {
  /** What it adds, as a busy store's note names it. */
  readonly what: string;
  /** Runs its transaction; what it added counts once it committed. */
  run(): void;
}

export type ImportTally = { -readonly [K in keyof ImportCounts]: ImportCounts[K] };

export const emptyTally = (): ImportTally => ({
  results: 0,
  alreadyStored: 0,
  closures: 0,
  observed: 0,
  startup: 0,
  rekeyed: 0,
});

/**
 * Spec 018 D3 as slices (021 D3), in the order one transaction wrote them:
 * closure lists and observed entries where the store has none; the
 * re-keying (D11), read once they committed; each file's row; the results,
 * the ones at one key in one slice, which tests whether the store holds
 * results there; last the environments and the import's own record. A
 * daemon reads an import as held by that record (`listImports`), so one
 * stopped between slices is imported again, and again adds only what is
 * missing. Each slice is yielded before it runs, and what follows is read
 * once it ran.
 */
export function* importSlices(
  store: Store,
  bundle: ResultsBundle,
  options: ImportOptions,
  tally: ImportTally,
): Generator<ImportSlice, void, undefined> {
  const conn = connectionOf(store);
  const write = (what: string, fn: () => void): ImportSlice => ({
    what,
    run: () => conn.transaction(fn),
  });
  for (const files of chunks(bundle.testFiles, IMPORT_SLICE_FILES)) {
    let added = 0;
    yield write("an import's closure lists", () => {
      added = addClosures(store, files, options);
    });
    tally.closures += added;
  }
  for (const [project, files] of groupBy(bundle.testFiles, (f) => f.project)) {
    let added = 0;
    yield write("an import's observed entries", () => {
      added = addObserved(store, project, files);
    });
    tally.observed += added;
  }
  if (bundle.observedStartup.length > 0) {
    let added = 0;
    yield write("an import's start-up lists", () => {
      added = addStartup(store, bundle);
    });
    tally.startup += added;
  }
  // Reads the lists as the store holds them now, the import's own among them.
  const { rekeying } = options;
  const rekeyed =
    rekeying === undefined
      ? new Map<string, Rekeyed>()
      : conn.read(() => rekeyFiles(store, bundle, rekeying));
  tally.rekeyed = rekeyed.size;
  for (const files of chunks(bundle.testFiles, IMPORT_SLICE_FILES)) {
    yield write("an import's files", () => {
      ensureImportTables(conn);
      recordFiles(store, bundle, files, options.importId, rekeyed);
    });
  }
  for (const group of resultSlices(bundle, rekeyed)) {
    let counts = { results: 0, alreadyStored: 0 };
    yield write("an import's results", () => {
      counts = addResults(store, bundle, group, options);
    });
    tally.results += counts.results;
    tally.alreadyStored += counts.alreadyStored;
  }
  yield write("an import's record", () => {
    putEnvironments(
      store,
      bundle.environments.flatMap(({ hash, descriptor }) =>
        descriptor === null ? [] : [{ hash, descriptor }],
      ),
      options.now,
    );
    ensureImportTables(conn);
    conn.run(
      `INSERT INTO imports (id, header, file_hash, imported_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      options.importId,
      JSON.stringify(bundle.header),
      options.fileHash,
      options.now,
    );
  });
}

/** A results slice: each result with the key it goes at. */
type ResultGroup = readonly (readonly [ExportedResult, CheckKey])[];

/** The results by key, keys whole, `IMPORT_SLICE_RESULTS` per slice where keys allow. */
function* resultSlices(
  bundle: ResultsBundle,
  rekeyed: ReadonlyMap<string, Rekeyed>,
): Generator<ResultGroup, void, undefined> {
  const keyed = bundle.results.map(
    (r) =>
      [r, rekeyed.get(testFileId({ project: r.project, path: r.testPath }))?.key ?? r.key] as const,
  );
  let slice: (readonly [ExportedResult, CheckKey])[] = [];
  for (const group of groupBy(keyed, ([, key]) => key).values()) {
    if (slice.length > 0 && slice.length + group.length > IMPORT_SLICE_RESULTS) {
      yield slice;
      slice = [];
    }
    slice.push(...group);
  }
  if (slice.length > 0) yield slice;
}

/** Each result of `group` with the import as its provenance, at a key the store holds none at. */
function addResults(
  store: Store,
  bundle: ResultsBundle,
  group: ResultGroup,
  options: ImportOptions,
): { results: number; alreadyStored: number } {
  const conn = connectionOf(store);
  const recordedAt = options.clock?.() ?? options.now;
  const held = new Map<CheckKey, boolean>();
  const records: ResultRecord[] = [];
  let alreadyStored = 0;
  for (const [r, key] of group) {
    const stored = held.get(key) ?? holdsKey(conn, key);
    held.set(key, stored);
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
      key,
      outcome: r.outcome,
      durationMs: r.durationMs,
      location: r.location,
      fingerprint: null,
      summary: null,
      errors: [],
      provenance: {
        worktreeId: importMark(options.importId),
        revision: 0,
        commit: bundle.header.commit,
        dirty: bundle.header.dirty,
        runId: importMark(options.importId),
        recordedAt,
      },
    });
  }
  store.results.putMany(records);
  return { results: records.length, alreadyStored };
}

/** The closure lists of `files` the store has none of. */
function addClosures(
  store: Store,
  files: readonly ExportedTestFile[],
  options: ImportOptions,
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
        updatedAt: options.now,
        updatedBy: importMark(options.importId),
      });
      closures++;
    }
  }
  return closures;
}

/** `project`'s observed entries the store has none of; how many of the `observed` map. */
function addObserved(
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

function addStartup(store: Store, bundle: ResultsBundle): number {
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
function recordFiles(
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

/** `items` in runs of `size`. */
function* chunks<T>(items: readonly T[], size: number): Generator<readonly T[], void, undefined> {
  for (let at = 0; at < items.length; at += size) yield items.slice(at, at + size);
}

/** The one closure method a store reads (`test-files.ts`). */
const METHOD = "static imports plus declared inputs" as const;
