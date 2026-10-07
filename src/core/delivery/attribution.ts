import { isInstalledLockfile, testFileId } from "../keys/index.js";
import type {
  CheckId,
  CheckKey,
  Consumer,
  DeltaEntry,
  KnownState,
  RelativePath,
  RevisionNumber,
  StatusHeader,
  Store,
  TestFileRef,
  TransitionEntry,
  WorktreeId,
} from "../types/index.js";
import { changedAfter, registration } from "./registered.js";

/*
 * Task 001-91, lessons defect 16: whether the agent's changes reach a failure
 * and the load a timeout ran under, read from the store at delivery.
 */

/** A summary that reads as a test or hook timeout (`withLoad` in the Vitest runner). */
const TIMED_OUT = /timed out in \d+ms/;

/**
 * The load average recorded with the newest failing result of `entry`'s
 * check from the worktree it came from; `undefined` when none was recorded.
 */
function loadOf(store: Store, worktreeId: WorktreeId, entry: TransitionEntry): number | undefined {
  if (entry.summary === null || !TIMED_OUT.test(entry.summary)) return undefined;
  const from = entry.origin.kind === "inherited" ? entry.origin.worktreeId : worktreeId;
  const result = store.results
    .listForCheck(entry.check, 5)
    .find((r) => r.outcome === "fail" && r.provenance.worktreeId === from);
  return result?.errors.find((e) => e.loadAverage !== undefined)?.loadAverage;
}

/**
 * The stored closure of `ref` when it is `worktreeId`'s: written by it, or by
 * a worktree whose current key for the file is its own, since a key covers
 * every closure path and its content. `undefined` otherwise: the store keeps
 * the newest closure of any worktree, and another branch can import other
 * files (task 001-94, review wave 10b S2).
 */
function closureFor(store: Store, worktreeId: WorktreeId) {
  const keys = new Map<WorktreeId, ReadonlyMap<string, CheckKey | null>>();
  const keyOf = (id: WorktreeId, ref: TestFileRef) => {
    let byFile = keys.get(id);
    if (byFile === undefined) {
      byFile = new Map(store.testFileKeys.list(id).map((r) => [testFileId(r.testFile), r.key]));
      keys.set(id, byFile);
    }
    return byFile.get(testFileId(ref)) ?? null;
  };
  return (ref: TestFileRef): readonly RelativePath[] | undefined => {
    const record = store.testFiles.get(ref);
    if (record === null) return undefined;
    if (record.updatedBy === worktreeId) return record.closure.paths;
    const key = keyOf(worktreeId, ref);
    return key !== null && key === keyOf(record.updatedBy, ref) ? record.closure.paths : undefined;
  };
}

/**
 * Each failure with the closure paths changed since `consumer` registered
 * (`TransitionEntry.changesInClosure`) and a timeout's load. The closure is
 * this worktree's (`closureFor`); an inherited result is read against this
 * worktree's changes, the ones the agent made.
 */
export function attribute(
  store: Store,
  consumer: Consumer,
  entries: readonly DeltaEntry[],
  revision: RevisionNumber,
): readonly DeltaEntry[] {
  if (!entries.some((e) => e.to === "fail")) return entries;
  const since = registration(store, consumer);
  const changed = since === null ? null : changedAfter(store, consumer.worktreeId, since, revision);
  const closureOf = closureFor(store, consumer.worktreeId);
  return entries.map((entry) => {
    if (entry.kind === "fail-retired" || entry.to !== "fail") return entry;
    const { project, testPath } = entry.check;
    const closure = changed === null ? undefined : closureOf({ project, path: testPath });
    const touched =
      changed === null || closure === undefined ? undefined : closure.filter((p) => changed.has(p));
    const load = loadOf(store, consumer.worktreeId, entry);
    return {
      ...entry,
      ...(touched === undefined ? {} : { changesInClosure: touched }),
      ...(load === undefined ? {} : { loadAverage: load }),
    };
  });
}

/**
 * `false` when the daemon has hashed this worktree's files and none is an
 * installed lockfile: no dependencies are installed. `true` when one is;
 * `undefined` while nothing is hashed, which says nothing.
 */
export function dependenciesInstalled(store: Store, worktreeId: WorktreeId): boolean | undefined {
  const files = store.fileHashes.list(worktreeId);
  if (files.length === 0) return undefined;
  return files.some((f) => isInstalledLockfile(f.path));
}

/** What `annotate` adds to a delta: the entries attributed, the header, the still-failing checks. */
export interface Annotated {
  readonly entries: readonly DeltaEntry[];
  readonly header: StatusHeader;
  readonly stillFailing: readonly CheckId[];
}

/**
 * A delta's entries with `attribute`, its header with
 * `dependenciesInstalled` when it reports a failure, and the checks failing
 * in `states` (task 001-91).
 */
export function annotate(
  store: Store,
  consumer: Consumer,
  entries: readonly DeltaEntry[],
  header: StatusHeader,
  states: readonly KnownState[],
): Annotated {
  return {
    entries: attribute(store, consumer, entries, header.revision),
    header: withDependencies(
      store,
      consumer.worktreeId,
      header,
      entries.some((e) => e.to === "fail"),
    ),
    stillFailing: states.filter((s) => s.outcome === "fail").map((s) => s.check),
  };
}

/** `header` with `dependenciesInstalled` when `failing`: the note matters only beside a failure. */
export function withDependencies(
  store: Store,
  worktreeId: WorktreeId,
  header: StatusHeader,
  failing: boolean,
): StatusHeader {
  const installed = failing ? dependenciesInstalled(store, worktreeId) : undefined;
  return installed === undefined ? header : { ...header, dependenciesInstalled: installed };
}
