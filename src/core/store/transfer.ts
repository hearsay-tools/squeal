import { compare } from "../fs/compare.js";
import { observedModulesMetaKey } from "../keys/modules.js";
import { observedDirectMetaKey, observedMetaKey, readSharedEntries } from "../keys/observed.js";
import { observedStartupMetaKey } from "../keys/startup.js";
import type { ProjectName, RelativePath, WorktreeId } from "../types/common.js";
import type { CheckKey, TestFileRef } from "../types/keys.js";
import type { Store } from "../types/store.js";
import { worktreeEnvironments } from "./environments.js";
import type { ExportHeader } from "./imports.js";
import { connectionOf, readTransaction } from "./store.js";
import {
  absolutePathIn,
  type ExportedResult,
  type ExportedTestFile,
  OBSERVED_MAPS,
  type ObservedMap,
  RESULTS_FORMAT,
  type ResultsBundle,
} from "./transfer-bundle.js";
import { exportedRows, groupBy } from "./transfer-rows.js";

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
