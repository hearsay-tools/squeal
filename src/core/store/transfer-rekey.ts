import { encodeSegment, keyFromSegments } from "../keys/check-key.js";
import { assembleClosure, isClosurePath } from "../keys/closure.js";
import { importDifferences } from "../keys/environment-descriptor.js";
import { observedModulesMetaKey } from "../keys/modules.js";
import {
  ABSENT_LISTING,
  listedDirectory,
  namesHash,
  observedDirectMetaKey,
  observedMetaKey,
  readSharedEntries,
} from "../keys/observed.js";
import { testFileId } from "../keys/reverse-index.js";
import type { ProjectName, RelativePath, WorktreeId } from "../types/common.js";
import type { CheckKey, EnvironmentHash, FileHash, TestFileRef } from "../types/keys.js";
import type { Store } from "../types/store.js";
import { worktreeEnvironment } from "./environments.js";
import {
  type ExportedEnvironment,
  type ExportedTestFile,
  type KeyParts,
  OBSERVED_MAPS,
  type ObservedEntries,
  type ResultsBundle,
} from "./transfer-bundle.js";

/*
 * Spec 018 D11: an import stores each exported file's results at the key
 * the file has here at the export's content: this worktree's closure list
 * (the stored list plus the shared observed entries, as the daemon
 * assembles them) over the blob ids of the export's commit, this worktree's
 * environment hash where D10 finds the two equal, and the key's two other
 * segments as the export gives them (`keyParts`). Re-keying needs proof: the
 * exported key must come out of the export's own list over the same commit
 * with the export's environment hash and those segments. This worktree's
 * list must also hold every path of the export's list (review wave-5 B1):
 * a key here that left out a file or listing the exported run read would
 * stay equal when that input changes. A daemon at the same content then
 * computes the same key; at other content it does not.
 */

/** What re-keying reads beside the store: the export commit's files (018 D11). */
export interface Rekeying {
  readonly worktreeId: WorktreeId;
  /** Each file's blob id at the export's commit (`committedBlobs`); `null` when the commit is not here. */
  readonly blobs: ReadonlyMap<RelativePath, FileHash> | null;
}

/** One exported file's key here and the inputs D5 compares (018 D11). */
export interface Rekeyed {
  readonly key: CheckKey;
  readonly environment: EnvironmentHash;
  /** The list the key was computed over. */
  readonly closure: readonly RelativePath[];
  /** This store's observed entries of the file, as the key took them. */
  readonly observed: ObservedEntries;
}

const NO_PARTS: KeyParts = { dependencies: "", runtime: "" };

const MAP_KEY = {
  observed: observedMetaKey,
  observedDirect: observedDirectMetaKey,
  observedModules: observedModulesMetaKey,
} as const;

/**
 * Each exported file of `bundle` that re-keys here, by `testFileId`. Reads
 * the closure lists and observed entries as the store holds them now, so call
 * it after the import added its own. Empty without the commit's files.
 */
export function rekeyFiles(
  store: Store,
  bundle: ResultsBundle,
  rekeying: Rekeying,
): Map<string, Rekeyed> {
  const out = new Map<string, Rekeyed>();
  if (rekeying.blobs === null) return out;
  const at = commitSegments(rekeying.blobs);
  const exported = new Map(bundle.environments.map((e) => [e.project, e]));
  const local = new Map<ProjectName, EnvironmentHash | null>();
  const entries = new Map<string, Record<string, RelativePath[]>>();
  const shared = (map: keyof typeof MAP_KEY, project: ProjectName) => {
    const key = MAP_KEY[map](project);
    const read = entries.get(key) ?? readSharedEntries(store, key);
    entries.set(key, read);
    return read;
  };
  for (const file of bundle.testFiles) {
    const environment = exported.get(file.project);
    if (environment === undefined || !proven(file, environment, at)) continue;
    if (!local.has(file.project)) {
      local.set(file.project, localHash(store, rekeying.worktreeId, environment));
    }
    const here = local.get(file.project) ?? null;
    const stored = store.testFiles.get(file)?.closure.paths;
    if (here === null || stored === undefined) continue;
    const observed: { -readonly [M in keyof ObservedEntries]: ObservedEntries[M] } = {};
    for (const map of OBSERVED_MAPS) {
      const paths = shared(map, file.project)[file.path];
      if (paths !== undefined) observed[map] = paths;
    }
    const ref: TestFileRef = { project: file.project, path: file.path };
    const closure = assembleClosure(
      { testFile: ref, paths: stored },
      [],
      (observed.observed ?? []).filter(isClosurePath),
    ).paths;
    if (!holdsEvery(closure, file.closure?.paths ?? [])) continue;
    const key = keyOver(here, ref, closure, at, file.keyParts ?? NO_PARTS);
    out.set(testFileId(ref), { key, environment: here, closure, observed });
  }
  return out;
}

/** Whether `file`'s exported key comes out of its own list over the commit, with the export's environment hash. */
function proven(
  file: ExportedTestFile,
  environment: ExportedEnvironment,
  at: (path: RelativePath) => string,
): boolean {
  if (file.closure === null) return false;
  const parts = file.keyParts ?? NO_PARTS;
  return keyOver(environment.hash, file, file.closure.paths, at, parts) === file.key;
}

/** Whether `here` holds every path of `exported`: a re-key may add inputs to a key, never drop one (review wave-5 B1). */
function holdsEvery(here: readonly RelativePath[], exported: readonly RelativePath[]): boolean {
  const held = new Set(here);
  return exported.every((path) => held.has(path));
}

/**
 * This worktree's environment hash of the export's project when D10 finds
 * the two equal for a pass; `null` when they differ, when this worktree has
 * none recorded yet, or when a side holds no descriptor to compare.
 */
function localHash(
  store: Store,
  worktreeId: WorktreeId,
  exported: ExportedEnvironment,
): EnvironmentHash | null {
  const here = worktreeEnvironment(store, worktreeId, exported.project);
  if (here === null) return null;
  if (here.hash === exported.hash) return here.hash;
  if (exported.descriptor === null || here.descriptor === null) return null;
  return importDifferences(exported.descriptor, here.descriptor).length === 0 ? here.hash : null;
}

/** The check key over `paths`, each `at` the commit (`checkKey`'s encoding). */
function keyOver(
  environment: EnvironmentHash,
  testFile: TestFileRef,
  paths: readonly RelativePath[],
  at: (path: RelativePath) => string,
  parts: KeyParts,
): CheckKey {
  const segments = paths.map(at);
  return keyFromSegments(environment, testFile, segments, parts.dependencies, parts.runtime);
}

/**
 * Each path's key segment as a daemon at the commit's content encodes it
 * (`encodeSegment`), once per path: a file by its blob id, none when the
 * commit holds no file there; a listing by the entry names of the commit's
 * tree, `ABSENT_LISTING` for a directory it does not hold.
 */
function commitSegments(
  blobs: ReadonlyMap<RelativePath, FileHash>,
): (path: RelativePath) => string {
  let names: Map<RelativePath, Set<string>> | null = null;
  const segments = new Map<RelativePath, string>();
  const hashOf = (path: RelativePath): FileHash | null => {
    const directory = listedDirectory(path);
    if (directory === null) return blobs.get(path) ?? null;
    names ??= entryNames(blobs.keys());
    const held = names.get(directory);
    return held === undefined ? ABSENT_LISTING : namesHash([...held]);
  };
  return (path) => {
    let segment = segments.get(path);
    if (segment === undefined) {
      segment = encodeSegment(path, hashOf(path));
      segments.set(path, segment);
    }
    return segment;
  };
}

/** Each directory's entry names: its files and the subdirectories that hold one. */
function entryNames(paths: Iterable<RelativePath>): Map<RelativePath, Set<string>> {
  const names = new Map<RelativePath, Set<string>>();
  for (const path of paths) {
    let directory = "";
    for (const name of path.split("/")) {
      const held = names.get(directory) ?? new Set<string>();
      held.add(name);
      names.set(directory, held);
      directory = directory === "" ? name : `${directory}/${name}`;
    }
  }
  return names;
}
