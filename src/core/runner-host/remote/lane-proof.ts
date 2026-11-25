import { merge } from "../../daemon/composite-runner.js";
import { testFileId } from "../../keys/reverse-index.js";
import type { TestFileRef } from "../../types/keys.js";
import type { ObservedInputs, RunReport } from "../../types/runner.js";
import { recordsWithout } from "./coverage.js";
import { withoutFiles } from "./lane-repository.js";
import type { RemoteRecord } from "./tree-wire.js";

/*
 * Row 026-24 (gh-280; spec 021 D10, D11, D17): a remote run's blob proof,
 * file by file. A path that differs between this worktree and the remote
 * taints only the files whose closure or observed inputs hold it; a config
 * path, or one no file holds, taints every file (it fails closed). A file no
 * differing path taints is proven, and its result is kept. A differing path
 * that exists here but is git-ignored is never sent (D10): a retry cannot
 * repair it, so its files are refused at once, never run again there.
 */

/** The paths a run's proof covers: the configs every file shares, each file's closure, all. */
export interface RunInputs {
  readonly configs: ReadonlySet<string>;
  /** Each test file's closure, by `testFileId`. */
  readonly byFile: ReadonlyMap<string, ReadonlySet<string>>;
  readonly all: readonly string[];
}

/** The proof's inputs from each file's closure paths, in `testFiles`' order, and the configs. */
export function runInputsOf(
  testFiles: readonly TestFileRef[],
  closures: readonly (readonly string[])[],
  configs: readonly string[],
): RunInputs {
  const byFile = new Map<string, ReadonlySet<string>>();
  testFiles.forEach((file, i) => {
    byFile.set(testFileId(file), new Set(closures[i] ?? []));
  });
  return {
    configs: new Set(configs),
    byFile,
    all: [...new Set([...closures.flat(), ...configs])],
  };
}

/** The paths `files` need proven: the configs and their own closures, each once. */
export function inputsFor(inputs: RunInputs, files: readonly TestFileRef[]): string[] {
  const paths = new Set(inputs.configs);
  for (const file of files)
    for (const path of inputs.byFile.get(testFileId(file)) ?? []) paths.add(path);
  return [...paths];
}

/** Differing paths: those a resend repairs, and those that exist here but Git ignores. */
export interface Differing {
  readonly syncable: readonly string[];
  readonly unsyncable: readonly string[];
}

/**
 * `differ` split by the sync boundary (D10): a path here that is not in the
 * tree (`inTree`, tracked or not ignored) is never sent; any other, or one
 * deleted here (`null` blob), a resend repairs.
 */
export function classify(
  differ: readonly string[],
  inTree: ReadonlySet<string>,
  localBlobs: Readonly<Record<string, string | null>>,
): Differing {
  const syncable: string[] = [];
  const unsyncable: string[] = [];
  for (const path of differ) {
    const here = localBlobs[path];
    (here !== null && here !== undefined && !inTree.has(path) ? unsyncable : syncable).push(path);
  }
  return { syncable, unsyncable };
}

/** `remaining` split by what taints each file: nothing, an unsyncable path, or syncable paths only. */
export interface ProofSplit {
  readonly proven: readonly TestFileRef[];
  /** Tainted by at least one unsyncable path: refused, never run there again. */
  readonly unsyncable: readonly TestFileRef[];
  /** Tainted by syncable paths alone: a resend may repair them. */
  readonly retry: readonly TestFileRef[];
  /** The unsyncable paths that tainted a file of `unsyncable`. */
  readonly ignored: readonly string[];
}

/**
 * Which files of `remaining` each differing path taints: a config path, or
 * one no file's closure nor `observed` inputs hold, taints all of them;
 * any other only the files that hold it.
 */
export function splitProof(
  remaining: readonly TestFileRef[],
  inputs: RunInputs,
  observed: readonly ObservedInputs[] | undefined,
  differing: Differing,
): ProofSplit {
  const seen = new Map<string, Set<string>>();
  for (const o of observed ?? []) {
    const id = testFileId(o.testFile);
    seen.set(id, new Set([...(seen.get(id) ?? []), ...o.paths]));
  }
  const holds = (file: TestFileRef, path: string) => {
    const id = testFileId(file);
    return inputs.byFile.get(id)?.has(path) === true || seen.get(id)?.has(path) === true;
  };
  const tainted = (path: string): readonly TestFileRef[] => {
    const holders = remaining.filter((file) => holds(file, path));
    return inputs.configs.has(path) || holders.length === 0 ? remaining : holders;
  };
  const bad = new Set<string>();
  const ignored = new Set<string>();
  for (const path of differing.unsyncable) {
    for (const file of tainted(path)) bad.add(testFileId(file));
    ignored.add(path);
  }
  const retry = new Set<string>();
  for (const path of differing.syncable) {
    for (const file of tainted(path)) retry.add(testFileId(file));
  }
  const of = (keep: (id: string) => boolean) => remaining.filter((file) => keep(testFileId(file)));
  return {
    proven: of((id) => !bad.has(id) && !retry.has(id)),
    unsyncable: of((id) => bad.has(id)),
    retry: of((id) => !bad.has(id) && retry.has(id)),
    ignored: [...ignored],
  };
}

/** Up to five paths, as each refusal names them. */
export function shown(paths: readonly string[]): string {
  return paths.slice(0, 5).join(", ");
}

/** Why the remote refused files whose git-ignored inputs differ (D17: what to do follows from it). */
export function ignoredReason(paths: readonly string[]): string {
  return `git-ignored input ${shown(paths)} exists locally and is not synced to remote`;
}

/** Why the remote refused files whose tree a resend did not repair. */
export function stayedReason(paths: readonly string[]): string {
  return `its tree stayed different at ${shown(paths)}`;
}

/** A proven part of a remote run: its report, of the proven files alone, and their coverage records. */
export interface ProvenPart {
  readonly report: RunReport;
  readonly coverage: readonly RemoteRecord[];
}

/** `report` and `coverage` without `unproved`'s results and records. */
export function provenPart(
  report: RunReport,
  coverage: readonly RemoteRecord[] | undefined,
  unproved: readonly TestFileRef[],
): ProvenPart {
  return {
    report: unproved.length === 0 ? report : withoutFiles(report, unproved),
    coverage: recordsWithout(coverage ?? [], unproved),
  };
}

/** The proven parts of a tier's attempts as one report, and their records; `null` when none. */
export function joinParts(parts: readonly ProvenPart[], name: string): ProvenPart | null {
  const [first] = parts;
  if (first === undefined) return null;
  if (parts.length === 1) return first;
  return {
    report: merge(parts.map((part) => ({ adapter: { name }, report: part.report }))),
    coverage: parts.flatMap((part) => part.coverage),
  };
}
