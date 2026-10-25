import { isInstalledLockfile, testFileId } from "../keys/index.js";
import { passedRetry } from "../retry/index.js";
import { readFailureKeys } from "../slow/state.js";
import { beforeEditsFor, checkIdentity, readFlakyNotes, testFileOf } from "../state/index.js";
import { testFileFrame } from "../status/test-frame.js";
import type {
  CheckId,
  CheckKey,
  Consumer,
  DeltaEntry,
  KnownFailure,
  KnownState,
  RelativePath,
  ResultRecord,
  RevisionNumber,
  SourceLocation,
  StatusHeader,
  Store,
  TestFileFrame,
  TransitionEntry,
  WorktreeId,
} from "../types/index.js";
import { closureFor } from "./closure.js";
import { changedAfter, registration, seesEveryChange } from "./registered.js";
import { slot } from "./slots.js";

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
 * Each failure with the closure paths changed since `consumer` registered
 * (`TransitionEntry.changesInClosure`) and a timeout's load. The closure is
 * this worktree's (`closureFor`); an inherited result is read against this
 * worktree's changes, the ones the agent made. A closure that holds a path a
 * `start` revision changed gets neither line: those changes may or may not
 * be the agent's (`changedAfter`, task 001-96). "None of the files changed here" also
 * needs `seesEveryChange`. A slow file's failure reads as any file's (spec 004 D8
 * as amended 2026-10-18, task 004-81). A failure first observed by this
 * consumer gets its baseline (`beforeEdits`, 011 C5 as amended, gh-32), and
 * each one its test-file frame (`testFileFrames`, gh-67).
 */
export function attribute(
  store: Store,
  consumer: Consumer,
  entries: readonly DeltaEntry[],
  revision: RevisionNumber,
): readonly DeltaEntry[] {
  if (!entries.some((e) => e.to === "fail")) return entries;
  const from = registration(store, consumer);
  const changesOf = closureChanges(store, consumer, revision);
  const before =
    from === null ? null : beforeEditsFor(store, consumer.worktreeId, slot(consumer), from.since);
  const frameOf = testFileFrames(store, consumer.worktreeId);
  return entries.map((entry) => {
    if (entry.kind === "fail-retired" || entry.to !== "fail") return entry;
    const load = loadOf(store, consumer.worktreeId, entry);
    const firstSeen = entry.kind === "first-seen-fail" && entry.from === null && before !== null;
    const frame = frameOf(entry.check, entry.location);
    const facts = {
      ...(load === undefined ? {} : { loadAverage: load }),
      ...(firstSeen ? { beforeEdits: before(entry.check) } : {}),
      ...(frame === undefined ? {} : { testFileFrame: frame }),
    };
    const told = changesOf(entry.check);
    return { ...entry, ...(told === undefined ? {} : { changesInClosure: told }), ...facts };
  });
}

/**
 * A reader of the closure paths of a check's test file changed since
 * `consumer` registered, up to `revision` (`TransitionEntry.changesInClosure`);
 * `undefined` when not known. Empty only when every change is known to be
 * seen (`seesEveryChange`).
 */
export function closureChanges(store: Store, consumer: Consumer, revision: RevisionNumber) {
  const from = registration(store, consumer);
  const changed = from === null ? null : changedAfter(store, consumer.worktreeId, from, revision);
  const sure = from !== null && seesEveryChange(store, consumer.worktreeId, from);
  const closureOf = closureFor(store, consumer.worktreeId);
  return ({ project, testPath }: CheckId): readonly RelativePath[] | undefined => {
    const closure = changed === null ? undefined : closureOf({ project, path: testPath });
    const touched =
      changed === null || closure === undefined || closure.some((p) => changed.unknown.has(p))
        ? undefined
        : closure.filter((p) => changed.changed.has(p));
    return touched?.length === 0 && !sure ? undefined : touched;
  };
}

/**
 * A reader of a failure's test-file frame in `worktreeId` (011 C5 as amended
 * 2026-10-21, gh-67): read from the stored row at the key the state sink
 * recorded for the failure (`readFailureKeys`) when that row is the
 * failure's, a fail at `location`. `undefined` when there is no such row
 * (replaced, pruned, or a setup check, which has none) or no frame. Each
 * key's rows are read once.
 */
export function testFileFrames(store: Store, worktreeId: WorktreeId) {
  const keys = readFailureKeys(store, worktreeId);
  const rows = new Map<CheckKey, readonly ResultRecord[]>();
  return (check: CheckId, location: SourceLocation | null): TestFileFrame | undefined => {
    const identity = checkIdentity(check);
    const key = keys.get(identity);
    if (key === undefined || location === null) return undefined;
    // `usedAt` 0: status reads this in its read transaction, so it takes no write lock (011-113).
    if (!rows.has(key)) rows.set(key, store.results.byKey(key, 0));
    const row = rows
      .get(key)
      ?.find((r) => r.outcome === "fail" && checkIdentity(r.check) === identity);
    const thrown = row?.errors[0]?.location ?? null;
    if (row === undefined || thrown === null || !samePosition(thrown, location)) return undefined;
    return testFileFrame(check, row.errors) ?? undefined;
  };
}

function samePosition(a: SourceLocation, b: SourceLocation): boolean {
  return a.path === b.path && a.line === b.line && a.column === b.column;
}

/** `failures`, each with its test-file frame when it has one (`testFileFrames`). */
export function withTestFileFrames(
  store: Store,
  worktreeId: WorktreeId,
  failures: readonly KnownFailure[],
): readonly KnownFailure[] {
  if (failures.length === 0) return failures;
  const frameOf = testFileFrames(store, worktreeId);
  return failures.map((f) => {
    const frame = frameOf(f.check, f.location);
    return frame === undefined ? f : { ...f, testFileFrame: frame };
  });
}

/**
 * 011 C5 as amended (gh-32): a registration's known failures with the
 * closure paths changed since the session first registered, when there are
 * any: a session that resumes or compacts keeps its registration revision.
 * A slow file's are kept too, as `attribute` keeps them (004 D8 as amended
 * 2026-10-18, task 004-81). Each also gets its test-file frame
 * (`withTestFileFrames`, gh-67), as `attribute` gives a delivered failure.
 */
export function withClosureChanges(
  store: Store,
  consumer: Consumer,
  failures: readonly KnownFailure[],
  revision: RevisionNumber,
): readonly KnownFailure[] {
  if (failures.length === 0) return failures;
  const changesOf = closureChanges(store, consumer, revision);
  return withTestFileFrames(store, consumer.worktreeId, failures).map((f) => {
    const paths = changesOf(f.check);
    return paths === undefined || paths.length === 0 ? f : { ...f, changesInClosure: paths };
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
    entries: withFlaky(
      store,
      consumer.worktreeId,
      attribute(store, consumer, entries, header.revision),
    ),
    header: withDependencies(
      store,
      consumer.worktreeId,
      header,
      entries.flatMap((e) => (e.to === "fail" ? [e.check] : [])),
    ),
    stillFailing: states.filter((s) => s.outcome === "fail").map((s) => s.check),
  };
}

/**
 * Each entry with its check's flaky note (`TransitionEntry.flaky`) when the
 * note was recorded under the worktree's current key for the check's test
 * file: the same inputs both failed and passed (task 001-170).
 */
function withFlaky(
  store: Store,
  worktreeId: WorktreeId,
  entries: readonly DeltaEntry[],
): readonly DeltaEntry[] {
  if (!entries.some((e) => e.kind !== "fail-retired")) return entries;
  const notes = readFlakyNotes(store);
  if (notes.size === 0) return entries;
  const keys = new Map(
    store.testFileKeys.list(worktreeId).map((r) => [testFileId(r.testFile), r.key]),
  );
  const rows = new Map<CheckKey, readonly ResultRecord[]>();
  // The run whose stored result stands for `check` at `key`: the one that recovered it.
  const runOf = (check: CheckId, key: CheckKey) => {
    if (!rows.has(key)) rows.set(key, store.results.byKey(key));
    const identity = checkIdentity(check);
    return rows.get(key)?.find((r) => checkIdentity(r.check) === identity)?.provenance.runId;
  };
  return entries.map((entry) => {
    if (entry.kind === "fail-retired") return entry;
    const note = notes.get(checkIdentity(entry.check));
    const key = keys.get(testFileId(testFileOf(entry.check)));
    if (note === undefined || note.key !== key) return entry;
    // Task 001-368: a pass the agent's retry produced names the reason it gave; only that pass (001-398, S2).
    const runId =
      entry.kind === "fail-to-pass" && key !== null ? runOf(entry.check, key) : undefined;
    const retry =
      runId !== undefined && key !== null
        ? passedRetry(store, testFileOf(entry.check), key, runId)
        : undefined;
    return { ...entry, flaky: note, ...(retry === undefined ? {} : { retry }) };
  });
}

/**
 * `header` with `dependenciesInstalled` when a check of a Node runner is among
 * `failing`: the note matters only beside a failure, and it reads only Node's
 * installed lockfiles. A pytest check runs only in an admitted environment
 * (spec 007 D2), so beside its failure the note would be false (task 007-40).
 */
export function withDependencies(
  store: Store,
  worktreeId: WorktreeId,
  header: StatusHeader,
  failing: readonly CheckId[],
): StatusHeader {
  const node = failing.some((check) => NODE_RUNNERS.has(store.checks.runnerOf(check) ?? ""));
  const installed = node ? dependenciesInstalled(store, worktreeId) : undefined;
  return installed === undefined ? header : { ...header, dependenciesInstalled: installed };
}

/**
 * The runners whose test files load what Node's installed lockfiles list, by
 * the name their environment gives (`RunnerEnvironment.runnerName`). A
 * check's runner is the one the store recorded with it (spec 016 D3); a check
 * with none, which an older daemon stored, is no Node runner's.
 */
const NODE_RUNNERS: ReadonlySet<string> = new Set(["vitest", "node-test"]);
