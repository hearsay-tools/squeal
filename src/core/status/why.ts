import { worktreeIdFor } from "../fs/index.js";
import { testFileId } from "../keys/index.js";
import {
  checkIdentity,
  failureKeysOnce,
  formatCheck,
  heldFailure,
  parseCheck,
  readFlakyNotes,
  testFileOf,
} from "../state/index.js";
import { storePaths } from "../store/index.js";
import {
  type AbsolutePath,
  type CheckId,
  type CheckKey,
  PAYLOAD_SCHEMA_VERSION,
  type ResultRecord,
  type Store,
  type WhyNoMatch,
  type WhyReport,
  type WhyResult,
} from "../types/index.js";
import { type StatusContext, type StatusStoreOptions, withStatusStore } from "./open.js";
import { runLogOf, shownResult } from "./run-log.js";

/** Most results `squeal why` lists for one check. */
export const WHY_RESULT_LIMIT = 20;

/** Most candidates listed when a name matches several checks. */
export const WHY_CANDIDATE_LIMIT = 20;

export interface WhyOptions extends StatusStoreOptions {
  /** Also read the check's test file's console lines from its run log (`--include-logs`). */
  readonly includeLogs?: boolean;
}

/**
 * `squeal why <check>` for the worktree containing `cwd`. Spec 001 D7:
 * "prints the full history and provenance of one check and the path to its
 * last run log." Reads the store directly and needs no daemon.
 *
 * `query` is a name in the shape `formatCheck` prints. When no check has that
 * exact name, a check of this worktree whose name contains `query` is taken
 * if it is the only one, or the only one whose name ends with it. A name
 * ending in `...`, as a delta prints a capped one, matches by the part before.
 */
export function readWhy(cwd: AbsolutePath, query: string, options: WhyOptions = {}): WhyResult {
  const includeLogs = options.includeLogs ?? false;
  return withStatusStore(cwd, options, (context) => {
    const worktreeId = worktreeIdFor(context.root);
    const exact = parseCheck(query);
    const check = exact !== null && known(context.store, worktreeId, exact) ? exact : null;
    const match = check ?? resolve(context.store, worktreeId, query.trim());
    return "found" in match ? match : report(context, match, includeLogs);
  });
}

function known(store: Store, worktreeId: string, check: CheckId): boolean {
  return (
    store.knownStates.get(worktreeId, check) !== null ||
    store.transitions.history(worktreeId, check).length > 0 ||
    store.results.listForCheck(check, 1).length > 0
  );
}

function resolve(store: Store, worktreeId: string, query: string): CheckId | WhyNoMatch {
  const named = [
    ...store.knownStates.list(worktreeId).map((s) => s.check),
    ...held(store, worktreeId),
  ]
    .filter((check, i, all) => all.findIndex((c) => sameCheck(c, check)) === i)
    .map((check) => ({ check, name: formatCheck(check) }));
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
  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    available: true,
    found: false,
    query,
    candidates: matches.slice(0, WHY_CANDIDATE_LIMIT).map((n) => n.check),
  };
}

/**
 * Checks of this worktree held under its current keys: another worktree's
 * fail, not yet confirmed here, with no known state of its own (review
 * wave-13i N1). Only the current keys, so no other worktree's history.
 */
function held(store: Store, worktreeId: string): CheckId[] {
  const failureKeys = failureKeysOnce(store, worktreeId);
  return store.testFileKeys.list(worktreeId).flatMap(({ key }) =>
    store.results
      .byKey(key, 0)
      .filter((r) => heldFailure(store, worktreeId, [r], failureKeys) !== undefined)
      .map((r) => r.check),
  );
}

function sameCheck(a: CheckId, b: CheckId): boolean {
  return checkIdentity(a) === checkIdentity(b);
}

function report(
  { store, root, commonDir }: StatusContext,
  check: CheckId,
  includeLogs: boolean,
): WhyReport {
  const worktreeId = worktreeIdFor(root);
  const worktreeRoots = Object.fromEntries(store.worktrees.list().map((w) => [w.id, w.root]));
  const knownState = store.knownStates.get(worktreeId, check);
  // Every stored result of the check, not only the listed ones: the shown one may be older (B4).
  const all = store.results.listForCheck(check, Number.MAX_SAFE_INTEGER);
  const logDirOf = (result: ResultRecord) =>
    store.runs.get(result.provenance.runId)?.logDir ?? null;
  const results = all.slice(0, WHY_RESULT_LIMIT).map((result) => ({
    result,
    worktreeRoot: worktreeRoots[result.provenance.worktreeId] ?? null,
    logDir: logDirOf(result),
  }));
  const key = currentKey(store, worktreeId, check);
  const heldFailure = heldFor(store, worktreeId, key, all);
  const shown = shownResult(worktreeId, knownState, key, all, heldFailure);
  const runsDir = storePaths(commonDir).runsDir;
  const flaky = readFlakyNotes(store).get(checkIdentity(check));
  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    available: true,
    found: true,
    worktreeId,
    worktreeRoot: worktreeRoots[worktreeId] ?? root,
    revision: store.revisions.latest(worktreeId)?.number ?? null,
    check,
    worktreeRoots,
    knownState,
    history: store.transitions.history(worktreeId, check),
    results,
    runLog: shown === null ? null : runLogOf(shown, logDirOf(shown), check, runsDir, includeLogs),
    ...(heldFailure === undefined ? {} : { heldFailure }),
    ...(flaky === undefined ? {} : { flaky }),
  };
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
