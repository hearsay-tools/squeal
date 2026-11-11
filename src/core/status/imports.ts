import { observedModulesMetaKey } from "../keys/modules.js";
import { observedDirectMetaKey, observedMetaKey, readSharedEntries } from "../keys/observed.js";
import { testFileId } from "../keys/reverse-index.js";
import { importsWaiting } from "../scheduler/imports-waiting.js";
import { readEnvironment, worktreeEnvironments } from "../store/environments.js";
import { type ImportFileRecord, importFiles, listImports, sourceLabel } from "../store/imports.js";
import {
  listHash,
  OBSERVED_MAPS,
  type ObservedEntries,
  observedHash,
  STATIC_LIST,
  staticListHash,
} from "../store/transfer-bundle.js";
import type { ProjectName, WorktreeId } from "../types/common.js";
import type { CheckKey } from "../types/keys.js";
import { importIdOf, type KnownState } from "../types/state.js";
import type { ImportNotCurrent, ImportStatus } from "../types/status.js";
import type { Store } from "../types/store.js";
import type { TestFileKeyRecord } from "../types/store-records.js";
import { compareEnvironment } from "./import-environment.js";

/*
 * Spec 018 D5: per import that has an exported file this worktree lists, how
 * many of those files are current here from it, and the rest by reason, in
 * this order: same key with another result kept, same key not adopted yet,
 * environment differs, closure list differs, observed set differs, content
 * differs (equal environment and lists: the file's bytes or a closure file's
 * differ), no local key yet. A file is current from an import only by the
 * known states the daemon adopted, never by an equal key alone (D5 as
 * amended, review wave-1-2 B1). The closure lists compare less the observed
 * paths they took, so a list that differs only by them reads "observed set
 * differs" (D15); a row stored before row 018-18 compares whole lists.
 *
 * Review of 0.1.428, B1: while the running daemon's keys have not taken an
 * import's observed entries (`imports-waiting.ts`), a file of that import
 * that would read "content differs" reads "waiting for keys" instead: its
 * key is the one from before the import, and the next refinement moves it.
 */

const MAP_KEY = {
  observed: observedMetaKey,
  observedDirect: observedDirectMetaKey,
  observedModules: observedModulesMetaKey,
} as const;

type Reason = keyof ImportNotCurrent | "current";

/** What one exported file's comparison reads: this worktree's key row, states, environment and lists. */
interface Here {
  readonly keys: ReadonlyMap<string, TestFileKeyRecord>;
  /** The current known states of each test file's checks, by `testFileId`. */
  readonly current: ReadonlyMap<string, readonly KnownState[]>;
  /** Whether the store holds a result import `importId` stored at `key`. */
  stored(importId: string, key: CheckKey): boolean;
  readonly environments: ReadonlyMap<ProjectName, string>;
  /** The imports whose observed entries the daemon's keys have not taken yet. */
  readonly waiting: ReadonlySet<string>;
  closure(file: ImportFileRecord): string | null;
  observed(file: ImportFileRecord): string;
}

/** Each import with a file `worktreeId` lists, newest first; empty before the first import. */
export function readImports(
  store: Store,
  worktreeId: WorktreeId,
  keys: readonly TestFileKeyRecord[],
  states: readonly KnownState[],
): ImportStatus[] {
  const imports = listImports(store);
  if (imports.length === 0) return [];
  const here = hereOf(store, worktreeId, keys, states);
  return imports.flatMap((record) => {
    const files = importFiles(store, record.id).filter((f) => here.keys.has(testFileId(f)));
    if (files.length === 0) return [];
    const notCurrent: Record<keyof ImportNotCurrent, number> = {
      sameKeyKept: 0,
      sameKeyNotAdopted: 0,
      environment: 0,
      closure: 0,
      observed: 0,
      content: 0,
      keysPending: 0,
      noKey: 0,
    };
    let currentFiles = 0;
    let currentResults = 0;
    for (const file of files) {
      const reason = reasonOf(file, here);
      if (reason === "current") currentFiles++;
      else notCurrent[reason]++;
      const current = here.current.get(testFileId(file)) ?? [];
      currentResults += current.filter((s) => fromImport(s, record.id)).length;
    }
    return [
      {
        importId: record.id,
        source: sourceLabel(record.header),
        commit: record.header.commit,
        importedAt: record.importedAt,
        currentResults,
        testFiles: files.length,
        currentFiles,
        notCurrent,
        environmentDifferences:
          notCurrent.environment === 0 ? [] : differences(store, worktreeId, files),
      },
    ];
  });
}

function reasonOf(file: ImportFileRecord, here: Here): Reason {
  const key = here.keys.get(testFileId(file));
  if (key?.key === file.key) return adoption(file, here);
  const environment = here.environments.get(file.project);
  if (environment !== undefined && environment !== file.environment) return "environment";
  const closure = here.closure(file);
  if (closure !== null && file.closure !== "" && closure !== file.closure) return "closure";
  if (here.observed(file) !== file.observed) return "observed";
  if (key?.key === null || key?.key === undefined) return "noKey";
  return here.waiting.has(file.importId) ? "keysPending" : "content";
}

/**
 * An equal key: current from the import when every current state of the
 * file's checks is the import's; another result kept when any is not, or
 * when the import stored nothing at the key (the store held results there);
 * else not adopted yet.
 */
function adoption(file: ImportFileRecord, here: Here): Reason {
  const current = here.current.get(testFileId(file)) ?? [];
  if (current.length > 0) {
    return current.every((s) => fromImport(s, file.importId)) ? "current" : "sameKeyKept";
  }
  return here.stored(file.importId, file.key) ? "sameKeyNotAdopted" : "sameKeyKept";
}

function fromImport(state: KnownState, importId: string): boolean {
  return state.origin?.kind === "imported" && state.origin.importId === importId;
}

/** The current known states of test and file checks, by test file. */
function currentByFile(states: readonly KnownState[]): Map<string, KnownState[]> {
  const byFile = new Map<string, KnownState[]>();
  for (const s of states) {
    if (s.validity !== "current" || s.check.kind === "setup") continue;
    const id = testFileId({ project: s.check.project, path: s.check.testPath });
    const list = byFile.get(id);
    if (list === undefined) byFile.set(id, [s]);
    else list.push(s);
  }
  return byFile;
}

function hereOf(
  store: Store,
  worktreeId: WorktreeId,
  keys: readonly TestFileKeyRecord[],
  states: readonly KnownState[],
): Here {
  const maps = new Map<string, Record<string, string[]>>();
  const entries = (map: keyof typeof MAP_KEY, project: ProjectName) => {
    const key = MAP_KEY[map](project);
    const read = maps.get(key) ?? readSharedEntries(store, key);
    maps.set(key, read);
    return read;
  };
  return {
    keys: new Map(keys.map((k) => [testFileId(k.testFile), k])),
    current: currentByFile(states),
    stored: (importId, key) =>
      store.results.byKey(key, 0).some((r) => importIdOf(r.provenance.worktreeId) === importId),
    environments: new Map(worktreeEnvironments(store, worktreeId).map((e) => [e.project, e.hash])),
    waiting: new Set(importsWaiting(store, worktreeId)),
    closure: (file) => {
      const record = store.testFiles.get(file);
      if (record === null) return null;
      if (!file.closure.startsWith(STATIC_LIST)) return listHash(record.closure.paths);
      return staticListHash(record.closure.paths, entries("observed", file.project)[file.path]);
    },
    observed: (file) => {
      const observed: { -readonly [M in keyof ObservedEntries]: ObservedEntries[M] } = {};
      for (const map of OBSERVED_MAPS) {
        const paths = entries(map, file.project)[file.path];
        if (paths !== undefined) observed[map] = paths;
      }
      return observedHash(observed);
    },
  };
}

/** D1's named differences of each project whose environment differs, the project named when more than one. */
function differences(
  store: Store,
  worktreeId: WorktreeId,
  files: readonly ImportFileRecord[],
): string[] {
  const exported = new Map(files.map((f) => [f.project, f.environment]));
  const local = new Map(worktreeEnvironments(store, worktreeId).map((e) => [e.project, e]));
  return [...exported].flatMap(([project, hash]) => {
    const comparison = compareEnvironment(
      { hash, descriptor: readEnvironment(store, hash) },
      local.get(project) ?? null,
    );
    if (comparison.kind === "equal" || comparison.kind === "unknown") return [];
    const named =
      comparison.differences.length === 0 ? ["parts not recorded"] : comparison.differences;
    return exported.size === 1 ? named : named.map((d) => `${project || "(default)"}: ${d}`);
  });
}
