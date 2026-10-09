import { worktreeIdFor } from "../fs/index.js";
import { testFileId } from "../keys/index.js";
import {
  checkIdentity,
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
  const named = store.knownStates.list(worktreeId).map((s) => ({
    check: s.check,
    name: formatCheck(s.check),
  }));
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

function report(
  { store, root, commonDir }: StatusContext,
  check: CheckId,
  includeLogs: boolean,
): WhyReport {
  const worktreeId = worktreeIdFor(root);
  const worktreeRoots = Object.fromEntries(store.worktrees.list().map((w) => [w.id, w.root]));
  const knownState = store.knownStates.get(worktreeId, check);
  const results = store.results.listForCheck(check, WHY_RESULT_LIMIT).map((result) => ({
    result,
    worktreeRoot: worktreeRoots[result.provenance.worktreeId] ?? null,
    logDir: store.runs.get(result.provenance.runId)?.logDir ?? null,
  }));
  const shown = shownResult(worktreeId, knownState, results);
  const runsDir = storePaths(commonDir).runsDir;
  const held = heldFor(
    store,
    worktreeId,
    check,
    results.map(({ result }) => result),
  );
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
    runLog: shown === null ? null : runLogOf(shown, check, runsDir, includeLogs),
    ...(held === undefined ? {} : { heldFailure: held }),
    ...(flaky === undefined ? {} : { flaky }),
  };
}

/**
 * The check's result under this worktree's current key for its test file
 * when it is another worktree's fail this worktree holds (`heldFailure`,
 * task 001-170). Read from the results `why` lists, newest first.
 */
function heldFor(
  store: Store,
  worktreeId: string,
  check: CheckId,
  results: readonly ResultRecord[],
): ResultRecord | undefined {
  const file = testFileId(testFileOf(check));
  const key = store.testFileKeys
    .list(worktreeId)
    .find((row) => testFileId(row.testFile) === file)?.key;
  if (key === undefined || key === null) return undefined;
  const current = results.filter((r) => r.key === key);
  return heldFailure(store, worktreeId, current);
}
