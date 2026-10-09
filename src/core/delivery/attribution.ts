import { isInstalledLockfile, testFileId } from "../keys/index.js";
import { readFailureKeys, readSlowArtifacts } from "../slow/state.js";
import { checkIdentity, type SlowPolicyView, worktreeSlowView } from "../state/index.js";
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
import { changedAfter, registration, seesEveryChange } from "./registered.js";

/*
 * Task 001-91, lessons defect 16: whether the agent's changes reach a failure
 * and the load a timeout ran under, read from the store at delivery.
 */

/** A summary that reads as a test or hook timeout (`withLoad` in the Vitest runner). */
const TIMED_OUT = /timed out in \d+ms/;

/**
 * Results of a check `loadOf` reads, newest first from every worktree. Other
 * worktrees running the same test push the timeout's own result down; five
 * lost it (review wave 10b, N2). Past this many the load line is left out,
 * never wrong.
 */
const LOAD_RESULTS_READ = 50;

/**
 * The load average recorded with the newest failing result of `entry`'s
 * check from the worktree it came from; `undefined` when none was recorded.
 */
function loadOf(store: Store, worktreeId: WorktreeId, entry: TransitionEntry): number | undefined {
  if (entry.summary === null || !TIMED_OUT.test(entry.summary)) return undefined;
  const from = entry.origin.kind === "inherited" ? entry.origin.worktreeId : worktreeId;
  const result = store.results
    .listForCheck(entry.check, LOAD_RESULTS_READ)
    .find((r) => r.outcome === "fail" && r.provenance.worktreeId === from);
  return result?.errors.find((e) => e.loadAverage !== undefined)?.loadAverage;
}

/**
 * Spec 004 D8, review wave 2 B2 and wave 2.5 B1: the declared artifact of the
 * slow run whose result `entry`'s state holds, as the worktree that ran it
 * recorded it with the result's key; `null` when the run is a slow file's by
 * today's policy but no declaration is known (a state or result from before
 * the records), `undefined` when the failure is no slow run's. The key is the
 * one the state sink recorded with the state (`failureKeys`), current,
 * pending or stale alike. A run recorded slow stays slow when the policy no
 * longer marks its file.
 */
function slowRunArtifact(
  worktreeId: WorktreeId,
  slow: SlowPolicyView | null,
  failureKeys: ReadonlyMap<string, CheckKey>,
  artifactOf: (from: WorktreeId, key: CheckKey) => readonly string[] | undefined,
  entry: TransitionEntry,
): readonly string[] | null | undefined {
  const { origin } = entry;
  const from = origin.kind === "inherited" ? origin.worktreeId : worktreeId;
  const key = failureKeys.get(checkIdentity(entry.check));
  const recorded = key === undefined ? undefined : artifactOf(from, key);
  if (recorded !== undefined) return recorded;
  const { project, testPath } = entry.check;
  return slow?.isSlow({ project, path: testPath }) === true ? null : undefined;
}

/** The declared artifact of a slow run of `key` in a worktree, reading each worktree's record once. */
function recordedArtifacts(store: Store) {
  const records = new Map<WorktreeId, ReadonlyMap<CheckKey, readonly string[]>>();
  return (from: WorktreeId, key: CheckKey): readonly string[] | undefined => {
    let byKey = records.get(from);
    if (byKey === undefined) {
      byKey = readSlowArtifacts(store, from);
      records.set(from, byKey);
    }
    return byKey.get(key);
  };
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
 * worktree's changes, the ones the agent made. A closure that holds a path a
 * `start` revision changed gets neither line: those changes may or may not
 * be the agent's (`changedAfter`, task 001-96). "None of the files changed here" also
 * needs `seesEveryChange`. A failure of a slow run (spec 004 D8) gets the
 * artifact that run was declared to test (`slowArtifact`, `slowRunArtifact`)
 * instead: its closure holds few sources, so the changes line would be true
 * and misleading.
 */
export function attribute(
  store: Store,
  consumer: Consumer,
  entries: readonly DeltaEntry[],
  revision: RevisionNumber,
): readonly DeltaEntry[] {
  if (!entries.some((e) => e.to === "fail")) return entries;
  const from = registration(store, consumer);
  const changed = from === null ? null : changedAfter(store, consumer.worktreeId, from, revision);
  const sure = from !== null && seesEveryChange(store, consumer.worktreeId, from);
  const closureOf = closureFor(store, consumer.worktreeId);
  const slow = worktreeSlowView(store, consumer.worktreeId);
  const failureKeys = readFailureKeys(store, consumer.worktreeId);
  const artifactOf = recordedArtifacts(store);
  return entries.map((entry) => {
    if (entry.kind === "fail-retired" || entry.to !== "fail") return entry;
    const { project, testPath } = entry.check;
    const load = loadOf(store, consumer.worktreeId, entry);
    const loaded = load === undefined ? {} : { loadAverage: load };
    const slowArtifact = slowRunArtifact(consumer.worktreeId, slow, failureKeys, artifactOf, entry);
    if (slowArtifact !== undefined) return { ...entry, slowArtifact, ...loaded };
    const closure = changed === null ? undefined : closureOf({ project, path: testPath });
    const touched =
      changed === null || closure === undefined || closure.some((p) => changed.unknown.has(p))
        ? undefined
        : closure.filter((p) => changed.changed.has(p));
    const told = touched?.length === 0 && !sure ? undefined : touched;
    return { ...entry, ...(told === undefined ? {} : { changesInClosure: told }), ...loaded };
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
