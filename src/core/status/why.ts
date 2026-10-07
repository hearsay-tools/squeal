import { worktreeIdFor } from "../fs/index.js";
import { formatCheck, parseCheck } from "../state/index.js";
import {
  type AbsolutePath,
  type CheckId,
  PAYLOAD_SCHEMA_VERSION,
  type Store,
  type WhyNoMatch,
  type WhyReport,
  type WhyResult,
} from "../types/index.js";
import { type StatusStoreOptions, withStatusStore } from "./open.js";

/** Most results `squeal why` lists for one check. */
export const WHY_RESULT_LIMIT = 20;

/** Most candidates listed when a name matches several checks. */
export const WHY_CANDIDATE_LIMIT = 20;

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
export function readWhy(
  cwd: AbsolutePath,
  query: string,
  options: StatusStoreOptions = {},
): WhyResult {
  return withStatusStore(cwd, options, ({ store, root }) => {
    const worktreeId = worktreeIdFor(root);
    const exact = parseCheck(query);
    if (exact !== null && known(store, worktreeId, exact)) return report(store, root, exact);
    const match = resolve(store, worktreeId, query.trim());
    return "found" in match ? match : report(store, root, match);
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

function report(store: Store, root: AbsolutePath, check: CheckId): WhyReport {
  const worktreeId = worktreeIdFor(root);
  const worktreeRoots = Object.fromEntries(store.worktrees.list().map((w) => [w.id, w.root]));
  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    available: true,
    found: true,
    worktreeId,
    worktreeRoot: worktreeRoots[worktreeId] ?? root,
    revision: store.revisions.latest(worktreeId)?.number ?? null,
    check,
    worktreeRoots,
    knownState: store.knownStates.get(worktreeId, check),
    history: store.transitions.history(worktreeId, check),
    results: store.results.listForCheck(check, WHY_RESULT_LIMIT).map((result) => ({
      result,
      worktreeRoot: worktreeRoots[result.provenance.worktreeId] ?? null,
      logDir: store.runs.get(result.provenance.runId)?.logDir ?? null,
    })),
  };
}
