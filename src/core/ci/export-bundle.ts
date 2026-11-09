import { compare } from "../fs/compare.js";
import { observedModulesMetaKey } from "../keys/modules.js";
import { observedDirectMetaKey, observedMetaKey, readSharedEntries } from "../keys/observed.js";
import { observedStartupMetaKey } from "../keys/startup.js";
import { worktreeEnvironments } from "../store/environments.js";
import type { ExportHeader } from "../store/imports.js";
import { AbsolutePathError } from "../store/transfer.js";
import {
  absolutePathIn,
  type ExportedResult,
  type ExportedTestFile,
  OBSERVED_MAPS,
  type ObservedEntries,
  type ObservedMap,
  RESULTS_FORMAT,
  type ResultsBundle,
} from "../store/transfer-bundle.js";
import type { ProjectName, RelativePath, WorktreeId } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { Store } from "../types/store.js";
import type { ResultRecord } from "../types/store-records.js";

/*
 * Spec 018 D2 as `squeal ci export` writes it (row 018-17): the bundle
 * `exportResults` reads from a daemon's store, here from the job's own keys
 * and the records the daemon's record path makes of the shards' results.
 * The rows are not stored first: only `store-results.ts` and `accept.ts`
 * write result rows (`test/keys/validity/reach.test.ts`). Environments and
 * observed entries are read from the job's store, where `WorktreeKeys`
 * wrote them, as `exportResults` reads a daemon's.
 */

const MAP_KEY: Readonly<Record<ObservedMap, (project: ProjectName) => string>> = {
  observed: observedMetaKey,
  observedDirect: observedDirectMetaKey,
  observedModules: observedModulesMetaKey,
};

/** One exported file without its observed entries, which the bundle reads, and its records. */
export interface KeyedFile {
  readonly file: Omit<ExportedTestFile, "observed">;
  /** `recordsForFile`'s rows of the file at `file.key`: passes and skips only. */
  readonly records: readonly ResultRecord[];
}

/**
 * The D2 bundle of `files`, sorted as a store lists them. Throws
 * `AbsolutePathError` before returning one that holds an absolute path.
 */
export function bundleOf(
  store: Store,
  worktreeId: WorktreeId,
  header: ExportHeader,
  files: readonly KeyedFile[],
): ResultsBundle {
  const sorted = [...files].sort(
    (a, b) => compare(a.file.project, b.file.project) || compare(a.file.path, b.file.path),
  );
  const projects = new Set(sorted.map(({ file }) => file.project));
  const bundle: ResultsBundle = {
    format: RESULTS_FORMAT,
    header,
    environments: worktreeEnvironments(store, worktreeId)
      .filter((e) => projects.has(e.project))
      .map(({ project, hash, descriptor }) => ({ project, hash, descriptor })),
    testFiles: sorted.map(({ file }) => ({ ...file, observed: observedOf(store, file) })),
    observedStartup: [...projects].sort(compare).flatMap((project) => {
      const paths = readSharedEntries(store, observedStartupMetaKey(project), "list")[""];
      return paths === undefined ? [] : [{ project, paths }];
    }),
    results: sorted.flatMap(({ records }) => [...records].sort(byCheck).map(exported)),
  };
  const absolute = absolutePathIn(bundle);
  if (absolute !== null) throw new AbsolutePathError(absolute);
  return bundle;
}

/** The file's entry in each observed map that has one. */
function observedOf(store: Store, testFile: TestFileRef): ObservedEntries {
  const observed: { -readonly [M in ObservedMap]?: readonly RelativePath[] } = {};
  for (const map of OBSERVED_MAPS) {
    const entry = readSharedEntries(store, MAP_KEY[map](testFile.project))[testFile.path];
    if (entry !== undefined) observed[map] = entry;
  }
  return observed;
}

/** A store's order of one file's rows: by kind, then full name (`transfer-rows.ts`). */
function byCheck(a: ResultRecord, b: ResultRecord): number {
  const name = (r: ResultRecord) => (r.check.kind === "test" ? r.check.fullName : "");
  return compare(a.check.kind, b.check.kind) || compare(name(a), name(b));
}

function exported(record: ResultRecord): ExportedResult {
  const { check } = record;
  return {
    project: check.project,
    testPath: check.testPath,
    kind: check.kind,
    fullName: check.kind === "test" ? check.fullName : null,
    location: record.location,
    key: record.key,
    outcome: record.outcome === "skip" ? "skip" : "pass",
    durationMs: record.durationMs,
  };
}
