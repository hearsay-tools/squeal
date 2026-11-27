import { merge } from "../../daemon/composite-runner.js";
import { testFileId } from "../../keys/reverse-index.js";
import type { RelativePath } from "../../types/common.js";
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
 *
 * Row 026-38 (#304; 011 C4/D4; review 0.1.662 B1): the proof weighs an
 * observed path only when the file's key keeps it (`keptObservations`, as
 * `provenObserved` decides): a path the key already holds stays; a new one
 * goes when it is the run's own scratch below a directory it wrote, or one
 * of the file's applied `runtimeFiles`. A
 * path deleted here that exists on the remote though no sync wrote it
 * there (`RemoteRunReply.unsynced`), such as a file the run made, is
 * refused at once too: a resend removes only what a sync wrote.
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

/**
 * Differing paths: those a resend repairs, and those it cannot: a path that
 * exists here but Git ignores, or one that exists only on the remote.
 */
export interface Differing {
  readonly syncable: readonly string[];
  readonly unsyncable: readonly string[];
  /** Row 026-38: the paths of `unsyncable` that exist only on the remote; absent, none. */
  readonly remoteOnly?: readonly string[];
}

/**
 * `differ` split by the sync boundary (D10): a path here that is not in the
 * tree (`inTree`, tracked or not ignored) is never sent; a path deleted here
 * (`null` blob) that no sync wrote there (`unsynced`, row 026-38) a resend
 * cannot remove; any other, or one deleted here that a sync wrote there, a
 * resend repairs.
 */
export function classify(
  differ: readonly string[],
  inTree: ReadonlySet<string>,
  localBlobs: Readonly<Record<string, string | null>>,
  unsynced: ReadonlySet<string> = new Set(),
): Differing {
  const syncable: string[] = [];
  const unsyncable: string[] = [];
  const remoteOnly: string[] = [];
  for (const path of differ) {
    const here = localBlobs[path];
    if (here === null && unsynced.has(path)) {
      unsyncable.push(path);
      remoteOnly.push(path);
    } else {
      (here !== null && here !== undefined && !inTree.has(path) ? unsyncable : syncable).push(path);
    }
  }
  return remoteOnly.length === 0 ? { syncable, unsyncable } : { syncable, unsyncable, remoteOnly };
}

/**
 * Row 026-38 (review 0.1.662 B1): the paths of one remote run's observation
 * that its reader's key keeps (`provenObserved` in `scheduler/proven-observed.ts`,
 * the one owner of that decision).
 */
export type ProvenObserved = (observed: ObservedInputs) => Promise<readonly RelativePath[]>;

/**
 * Row 026-38 (#304): each observation's paths among `differ` that its
 * reader's key keeps (`kept`), so the proof drops exactly what the key
 * drops. Absent `kept`: every path, as before row 026-38.
 */
export async function keptObservations(
  observed: readonly ObservedInputs[],
  differ: readonly string[],
  kept?: ProvenObserved,
): Promise<ObservedInputs[]> {
  const differs = new Set(differ);
  return Promise.all(
    observed.map(async (o) => {
      const among = o.paths.filter((path) => differs.has(path));
      const paths =
        kept === undefined || among.length === 0 ? among : await kept({ ...o, paths: among });
      return { ...o, paths: [...paths] };
    }),
  );
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

/**
 * Row 026-38 (#304): why the remote refused files whose inputs exist only
 * there, and the two ways out (D17: what to do follows from it).
 */
export function remoteOnlyReason(paths: readonly string[]): string {
  return `input ${shown(paths)} exists only on the remote, where no sync wrote it, so a resend cannot remove it; declare it in runtimeFiles when it is runtime state, or list its test files in remote.alwaysLocal`;
}

/** Why the remote refused files whose inputs a resend cannot repair: `remoteOnly` ones and git-ignored ones. */
export function unsyncableReason(
  paths: readonly string[],
  remoteOnly: ReadonlySet<string>,
): string {
  const only = paths.filter((path) => remoteOnly.has(path));
  const ignored = paths.filter((path) => !remoteOnly.has(path));
  return [
    ...(ignored.length > 0 ? [ignoredReason(ignored)] : []),
    ...(only.length > 0 ? [remoteOnlyReason(only)] : []),
  ].join("; ");
}

/** Why the remote refused files whose tree a resend did not repair. */
export function stayedReason(paths: readonly string[]): string {
  return `its tree stayed different at ${shown(paths)}`;
}

/**
 * Row 026-40 (#300): the status of a run whose tree stayed different after
 * its one resend: the paths, and the way out.
 */
export function stayedStatus(paths: readonly string[]): string {
  return `refused a run whose tree stayed different at ${shown(paths)} after one resend; something on the remote rewrites them: list the test files that read them in remote.alwaysLocal`;
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
