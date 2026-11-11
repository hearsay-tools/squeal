import { KEY_FORMAT_VERSION } from "../keys/key-format.js";
import { observedModulesMetaKey } from "../keys/modules.js";
import { addMissingEntries, observedDirectMetaKey, observedMetaKey } from "../keys/observed.js";
import { testFileId } from "../keys/reverse-index.js";
import { observedStartupMetaKey } from "../keys/startup.js";
import type { CheckId } from "../types/check.js";
import type { EpochMs, ProjectName } from "../types/common.js";
import type { CheckKey } from "../types/keys.js";
import { importMark } from "../types/state.js";
import type { SquealBuild } from "../types/status.js";
import type { Store } from "../types/store.js";
import type { ResultRecord } from "../types/store-records.js";
import { putEnvironments } from "./environments.js";
import { ensureImportTables } from "./imports.js";
import { connectionOf } from "./store.js";
import {
  OBSERVED_MAPS,
  type ObservedMap,
  observedHash,
  type ResultsBundle,
  staticListHash,
} from "./transfer-bundle.js";
import { type Rekeyed, type Rekeying, rekeyFiles } from "./transfer-rekey.js";
import { groupBy, holdsKey } from "./transfer-rows.js";

const MAP_KEY: Readonly<Record<ObservedMap, (project: ProjectName) => string>> = {
  observed: observedMetaKey,
  observedDirect: observedDirectMetaKey,
  observedModules: observedModulesMetaKey,
};

/**
 * Spec 018 D3: why this Squeal refuses `bundle`, naming both key formats, or
 * `null`. A result at another format's key could never be current here.
 */
export function importRefusal(bundle: ResultsBundle): string | null {
  const theirs = otherKeyFormat(bundle);
  if (theirs === null) return null;
  return `the export's key format is ${theirs.keyFormat}; this Squeal's is ${KEY_FORMAT_VERSION}`;
}

/**
 * Spec 018 D21: the Squeal that wrote `bundle` and its key format, when that
 * format is not this Squeal's (`importRefusal`); else `null`.
 */
export function otherKeyFormat(bundle: ResultsBundle): SquealBuild | null {
  const { squealVersion, keyFormat } = bundle.header;
  return keyFormat === KEY_FORMAT_VERSION ? null : { version: squealVersion, keyFormat };
}

/** What an import added (018 D3). */
export interface ImportCounts {
  readonly results: number;
  /** Results left as they were: the store held results at their key already. */
  readonly alreadyStored: number;
  readonly closures: number;
  readonly observed: number;
  readonly startup: number;
  /** Test files whose results went at their key here (018 D11), not at the exported key. */
  readonly rekeyed: number;
}

/** A dry run's way out of its transaction. */
class DryRun extends Error {
  constructor(readonly counts: ImportCounts) {
    super("dry run");
  }
}

/**
 * Spec 018 D3: adds `bundle` to the store in one transaction: the import's
 * rows; closure lists and observed entries only where the store has none;
 * each result with the import as its provenance and `now` as its record
 * time, so running daemons read the keys as new (`StoredKeys`), at the key
 * its file has here at the export's content when `rekeying` proves one (D11,
 * `rekeyFiles`), else at the exported key; the environment descriptors. A
 * key the store holds results at keeps them. With `dryRun` the transaction
 * rolls back and the counts stay.
 */
export function importResults(
  store: Store,
  bundle: ResultsBundle,
  options: {
    readonly importId: string;
    readonly fileHash: string;
    readonly now: EpochMs;
    readonly dryRun?: boolean;
    readonly rekeying?: Rekeying;
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
      const lists = addLists(store, bundle, importId, now);
      const rekeyed =
        options.rekeying === undefined
          ? new Map<string, Rekeyed>()
          : rekeyFiles(store, bundle, options.rekeying);
      recordFiles(store, bundle, importId, rekeyed);
      const counts = {
        ...addResults(store, bundle, importId, now, rekeyed),
        ...lists,
        rekeyed: rekeyed.size,
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
  rekeyed: ReadonlyMap<string, Rekeyed>,
): Pick<ImportCounts, "results" | "alreadyStored"> {
  const conn = connectionOf(store);
  const held = new Map<CheckKey, boolean>();
  const records: ResultRecord[] = [];
  let alreadyStored = 0;
  for (const r of bundle.results) {
    const key = rekeyed.get(testFileId({ project: r.project, path: r.testPath }))?.key ?? r.key;
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

/**
 * D5's row of each exported file: the key its results went at, and the
 * environment, static list and observed entries that key was computed from,
 * here when re-keyed, else as the export held them.
 */
function recordFiles(
  store: Store,
  bundle: ResultsBundle,
  importId: string,
  rekeyed: ReadonlyMap<string, Rekeyed>,
): void {
  const conn = connectionOf(store);
  const hashes = new Map(bundle.environments.map((e) => [e.project, e.hash]));
  for (const f of bundle.testFiles) {
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
