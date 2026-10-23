import { worktreeIdFor } from "../fs/index.js";
import { testFileId } from "../keys/index.js";
import { withRecorded } from "../retry/index.js";
import {
  checkIdentity,
  failureKeysOnce,
  formatCheck,
  heldFailure,
  observedSince,
  parseCheck,
  readFlakyNotes,
  readRerunFirstFailures,
  readRevisionCommit,
  shownResult,
  testFileOf,
} from "../state/index.js";
import { storePaths } from "../store/index.js";
import {
  type AbsolutePath,
  type CheckId,
  type CheckKey,
  PAYLOAD_SCHEMA_VERSION,
  type ReplacedFailure,
  type ResultRecord,
  type RevisionNumber,
  type Store,
  type WhyChangedPath,
  type WhyChangedSince,
  type WhyNoMatch,
  type WhyReport,
  type WhyResult,
  type WorktreeId,
} from "../types/index.js";
import { durationsOf } from "./durations.js";
import { type StatusContext, type StatusStoreOptions, withStatusStore } from "./open.js";
import { newestFirst, replacedOfCheck } from "./replaced-failures.js";
import { runLogOf } from "./run-log.js";
import { testFileFrame } from "./test-frame.js";
import { type WhySession, whyClosureChanges } from "./why-closure.js";
import { replacement, unshownLog } from "./why-log.js";
import { namesFile, whyRankedBy } from "./why-rank.js";
import { unknownRunOf } from "./why-unknown.js";

/** Most results `squeal why` lists for one check. */
export const WHY_RESULT_LIMIT = 20;

/** Most stored failures older than the listed results `why` keeps visible (row 011-77, gh-67 Q3). */
export const WHY_OLDER_FAILURE_LIMIT = 5;

/** Most candidates listed when a name matches several checks. */
export const WHY_CANDIDATE_LIMIT = 20;

/** Most paths, and most revisions of one path, the changed-since line lists (task 001-225). */
export const WHY_CHANGED_LIMIT = 20;

export interface WhyOptions extends StatusStoreOptions {
  /** Also read the check's test file's console lines from its run log (`--include-logs`). */
  readonly includeLogs?: boolean;
  /** The harness session the shell runs in, for the closure line (011-18); none when absent. */
  readonly session?: WhySession;
}

/**
 * `squeal why <check>` for the worktree containing `cwd`. Spec 001 D7:
 * "prints the full history and provenance of one check and the path to its
 * last run log." Reads the store directly and needs no daemon.
 *
 * `query` is a name in the shape `formatCheck` prints. When no check has that
 * exact name, a check of this worktree, or one with a kept replaced failure,
 * whose name contains `query` is taken if it is the only one, or the only
 * one whose name ends with it. A name ending in `...`, as a delta prints a
 * capped one, matches by the part before.
 */
export function readWhy(cwd: AbsolutePath, query: string, options: WhyOptions = {}): WhyResult {
  const includeLogs = options.includeLogs ?? false;
  return withStatusStore(cwd, options, (context) => {
    const { store } = context;
    const worktreeId = worktreeIdFor(context.root);
    // Review 0.1.265 B2: a kept failure outlives its worktree's states and results; it names a check.
    const kept = newestFirst(store.failures.replaced());
    const exact = parseCheck(query);
    const check = exact !== null && known(store, worktreeId, exact, kept) ? exact : null;
    const match = check ?? resolve(store, worktreeId, query.trim(), kept);
    const session = options.session ?? { session: null, agent: null };
    return "found" in match ? match : report(context, match, includeLogs, session, kept);
  });
}

function known(
  store: Store,
  worktreeId: string,
  check: CheckId,
  kept: readonly ReplacedFailure[],
): boolean {
  const identity = checkIdentity(check);
  return (
    store.knownStates.get(worktreeId, check) !== null ||
    store.transitions.history(worktreeId, check).length > 0 ||
    store.results.listForCheck(check, 1).length > 0 ||
    kept.some((e) => checkIdentity(e.check) === identity)
  );
}

/** Candidates are this worktree's checks, then every worktree's kept checks: at most 1,024, each once. */
function resolve(
  store: Store,
  worktreeId: string,
  query: string,
  kept: readonly ReplacedFailure[],
): CheckId | WhyNoMatch {
  const named = distinct([
    ...store.knownStates.list(worktreeId).map((s) => s.check),
    ...held(store, worktreeId),
    ...kept.map((e) => e.check),
  ]).map((check) => ({ check, name: formatCheck(check) }));
  const stem = query.endsWith("...") ? query.slice(0, -3) : null;
  let matches = named.filter(
    (n) => n.name.includes(query) || (stem !== null && n.name.startsWith(stem)),
  );
  if (matches.length > 1) {
    const ending = matches.filter(
      (n) => n.name.endsWith(` > ${query}`) || n.name.endsWith(`/${query}`),
    );
    if (ending.length === 1) matches = ending;
  }
  const [only] = matches;
  if (matches.length === 1 && only !== undefined) return only.check;
  const candidates = matches.slice(0, WHY_CANDIDATE_LIMIT).map((n) => n.check);
  const rankedBy = whyRankedBy(store, worktreeId, namesFile(query));
  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    available: true,
    found: false,
    query,
    candidates,
    candidateDurations: candidates.map((c) =>
      durationsOf(store.results.listForCheck(c, Number.MAX_SAFE_INTEGER)),
    ),
    queuedWithoutResult: queuedWithoutResult(store, worktreeId),
    ...(rankedBy === undefined ? {} : { rankedBy }),
  };
}

/**
 * 011 C4 as amended (gh-31, task 011-17): how many test files of this
 * worktree are queued or running with no result at their current key. A
 * test that has never run has no check row, so it may be in one of them.
 */
function queuedWithoutResult(store: Store, worktreeId: string): number {
  return store.testFileKeys
    .list(worktreeId)
    .filter(
      ({ key, pending }) =>
        key !== null && pending !== null && store.results.checksForKey(key).length === 0,
    ).length;
}

/**
 * Checks of this worktree held under its current keys: another worktree's
 * fail, not yet confirmed here, with no known state of its own (review
 * wave-13i N1). Only the current keys, so no other worktree's history.
 */
function held(store: Store, worktreeId: string): CheckId[] {
  const failureKeys = failureKeysOnce(store, worktreeId);
  // `usedAt` 0: a read, so `why` takes no write lock beside a daemon's writes (011-01, issue 7).
  return store.testFileKeys.list(worktreeId).flatMap(({ key }) =>
    store.results
      .byKey(key, 0)
      .filter((r) => heldFailure(store, worktreeId, [r], failureKeys) !== undefined)
      .map((r) => r.check),
  );
}

/**
 * Each check once, in the order of its first appearance. One pass over a
 * set of identities: a `findIndex` per check was quadratic and took 29 s
 * at 20,000 known checks (task 011-50, gh-55).
 */
function distinct(checks: readonly CheckId[]): CheckId[] {
  const seen = new Set<string>();
  return checks.filter((check) => {
    const identity = checkIdentity(check);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function report(
  { store, root, commonDir }: StatusContext,
  check: CheckId,
  includeLogs: boolean,
  session: WhySession,
  kept: readonly ReplacedFailure[],
): WhyReport {
  const worktreeId = worktreeIdFor(root);
  const worktreeRoots = Object.fromEntries(store.worktrees.list().map((w) => [w.id, w.root]));
  const knownState = store.knownStates.get(worktreeId, check);
  // Every stored result of the check, not only the listed ones: the shown one may be older (B4).
  const all = store.results.listForCheck(check, Number.MAX_SAFE_INTEGER);
  const logDirOf = (result: ResultRecord) =>
    store.runs.get(result.provenance.runId)?.logDir ?? null;
  const entry = (result: ResultRecord) => ({
    result,
    worktreeRoot: worktreeRoots[result.provenance.worktreeId] ?? null,
    logDir: logDirOf(result),
  });
  const results = all.slice(0, WHY_RESULT_LIMIT).map(entry);
  // Row 011-77 (gh-67 Q3): newest 20 passes never hide the check's older stored failures.
  const olderFailures = all
    .slice(WHY_RESULT_LIMIT)
    .filter((r) => r.outcome === "fail")
    .slice(0, WHY_OLDER_FAILURE_LIMIT)
    .map(entry);
  const replacedFailures = replacedOfCheck(store, check, worktreeRoots, kept);
  const runsDir = storePaths(commonDir).runsDir;
  const logOf = (run: { runId: string; worktreeId: WorktreeId }, logDir: AbsolutePath | null) =>
    runLogOf(run, logDir, check, runsDir, includeLogs);
  const unknownRun = unknownRunOf(store, worktreeId, check, knownState, logOf);
  const key = currentKey(store, worktreeId, check);
  const heldFailure = heldFor(store, worktreeId, key, all);
  const since = observedSince(store, worktreeId, knownState?.observedAt ?? null);
  const shown = shownResult(worktreeId, knownState, key, all, heldFailure, since);
  const replacedAtKey = replacement(store, knownState, key, all, shown);
  // 011 C5 as amended 2026-10-21 (gh-67): read from the result behind the state, never another's.
  const frame = shown?.outcome === "fail" ? testFileFrame(check, shown.errors) : null;
  const flaky = readFlakyNotes(store).get(checkIdentity(check));
  // B2 (review wave-2b): a re-run's first error, only while it is of the current key.
  const first = readRerunFirstFailures(store).get(checkIdentity(check));
  const rerunFirstFailure =
    first !== undefined && first.key === key
      ? { ...first, logDir: store.runs.get(first.runId)?.logDir ?? null }
      : undefined;
  const latest = store.revisions.latest(worktreeId);
  const revision = latest?.number ?? null;
  const commit = readRevisionCommit(store, worktreeId, latest);
  const changed = changedSince(store, worktreeId, knownState?.observedAt ?? null, revision);
  const closure = whyClosureChanges(store, worktreeId, check, knownState, revision, session);
  // Row 011-67 (gh-52): the facts status gives a known failure, read from the same producer.
  const recorded =
    knownState === null
      ? undefined
      : withRecorded(store, worktreeId, [knownState], revision ?? 0)[0]?.recorded;
  const file = testFileId(testFileOf(check));
  const rankedBy = whyRankedBy(store, worktreeId, (ref) => testFileId(ref) === file);
  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    available: true,
    found: true,
    worktreeId,
    worktreeRoot: worktreeRoots[worktreeId] ?? root,
    revision,
    ...(commit === undefined ? {} : { commit }),
    check,
    worktreeRoots,
    knownState,
    ...(recorded === undefined ? {} : { recorded }),
    ...(frame === null ? {} : { testFileFrame: frame }),
    history: store.transitions.history(worktreeId, check),
    results,
    durations: durationsOf(all),
    ...(shown === null
      ? unshownLog(store, worktreeId, knownState, key, replacedAtKey, logOf)
      : { runLog: logOf(shown.provenance, logDirOf(shown)) }),
    ...(unknownRun === undefined ? {} : { unknownRun }),
    ...(replacedAtKey === undefined ? {} : { replacedAtKey }),
    ...(heldFailure === undefined ? {} : { heldFailure }),
    ...(flaky === undefined ? {} : { flaky }),
    ...(olderFailures.length === 0 ? {} : { olderFailures }),
    ...(replacedFailures.length === 0 ? {} : { replacedFailures }),
    ...(rerunFirstFailure === undefined ? {} : { rerunFirstFailure }),
    ...(changed === undefined ? {} : { changedSince: changed }),
    ...(closure === undefined ? {} : { changesInClosure: closure }),
    ...(rankedBy === undefined ? {} : { rankedBy }),
  };
}

/**
 * Task 001-225 (005 D6): each path the revision records name after
 * `observedAt`, with the revisions that changed it, when `observedAt` is
 * older than `current`. Paths in the order of their first change.
 */
function changedSince(
  store: Store,
  worktreeId: WorktreeId,
  observedAt: RevisionNumber | null,
  current: RevisionNumber | null,
): WhyChangedSince | undefined {
  if (observedAt === null || current === null || observedAt >= current) return undefined;
  const byPath = new Map<string, RevisionNumber[]>();
  for (const revision of store.revisions.range(worktreeId, observedAt, current)) {
    for (const { path } of revision.changes) {
      const numbers = byPath.get(path) ?? [];
      if (numbers.at(-1) !== revision.number) numbers.push(revision.number);
      byPath.set(path, numbers);
    }
  }
  if (byPath.size === 0) return undefined;
  const paths: WhyChangedPath[] = [...byPath]
    .slice(0, WHY_CHANGED_LIMIT)
    .map(([path, numbers]) => ({
      path,
      revisions: numbers.slice(0, WHY_CHANGED_LIMIT),
      revisionCount: numbers.length,
    }));
  return { revision: observedAt, paths, total: byPath.size };
}

/** This worktree's current key for the check's test file; `null` when it has none. */
function currentKey(store: Store, worktreeId: string, check: CheckId): CheckKey | null {
  const file = testFileId(testFileOf(check));
  return (
    store.testFileKeys.list(worktreeId).find((row) => testFileId(row.testFile) === file)?.key ??
    null
  );
}

/**
 * The check's result under this worktree's current key for its test file
 * when it is another worktree's fail this worktree holds (`heldFailure`,
 * task 001-170).
 */
function heldFor(
  store: Store,
  worktreeId: string,
  key: CheckKey | null,
  results: readonly ResultRecord[],
): ResultRecord | undefined {
  if (key === null) return undefined;
  return heldFailure(
    store,
    worktreeId,
    results.filter((r) => r.key === key),
  );
}
