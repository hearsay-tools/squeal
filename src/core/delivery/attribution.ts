import { isInstalledLockfile } from "../keys/index.js";
import type {
  CheckId,
  Consumer,
  DeltaEntry,
  KnownState,
  RelativePath,
  RevisionNumber,
  StatusHeader,
  Store,
  TransitionEntry,
  WorktreeId,
} from "../types/index.js";
import { readSlot, writeSlot } from "./slots.js";

/*
 * Task 001-91, lessons defect 16: whether the agent's changes reach a failure
 * and the load a timeout ran under, read from the store at delivery.
 */

/** `meta` key of a worktree's registration revisions. */
export function registeredMetaKey(worktreeId: WorktreeId): string {
  return `revision-registered:${worktreeId}`;
}

/** The revision `consumer` registered at; `null` when none was recorded (registered by 0.1.9 or older). */
export function registeredRevision(store: Store, consumer: Consumer): RevisionNumber | null {
  const at = readSlot(store, registeredMetaKey(consumer.worktreeId), consumer);
  return typeof at === "number" ? at : null;
}

/** Records the revision `consumer` registered at; `null` forgets it. Call inside a transaction. */
export function tellRegistered(store: Store, consumer: Consumer, revision: RevisionNumber | null) {
  writeSlot(store, registeredMetaKey(consumer.worktreeId), consumer, revision);
}

/** The paths revisions after `since` up to `revision` changed. */
function changedAfter(
  store: Store,
  worktreeId: WorktreeId,
  since: RevisionNumber,
  revision: RevisionNumber,
): ReadonlySet<RelativePath> {
  const paths = new Set<RelativePath>();
  for (let n = since + 1; n <= revision; n++) {
    for (const change of store.revisions.get(worktreeId, n)?.changes ?? []) paths.add(change.path);
  }
  return paths;
}

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
 * Each failure with the closure paths changed since `consumer` registered
 * (`TransitionEntry.changesInClosure`) and a timeout's load. A closure is
 * the newest stored for the test file; an inherited result is read against
 * this worktree's changes, the ones the agent made.
 */
export function attribute(
  store: Store,
  consumer: Consumer,
  entries: readonly DeltaEntry[],
  revision: RevisionNumber,
): readonly DeltaEntry[] {
  if (!entries.some((e) => e.to === "fail")) return entries;
  const since = registeredRevision(store, consumer);
  const changed = since === null ? null : changedAfter(store, consumer.worktreeId, since, revision);
  return entries.map((entry) => {
    if (entry.kind === "fail-retired" || entry.to !== "fail") return entry;
    const { project, testPath } = entry.check;
    const closure = store.testFiles.get({ project, path: testPath })?.closure.paths;
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
