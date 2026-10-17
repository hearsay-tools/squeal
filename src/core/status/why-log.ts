import { readFailureKeys } from "../slow/state.js";
import { checkIdentity, readFailureProducers } from "../state/index.js";
import type {
  AbsolutePath,
  CheckKey,
  KnownState,
  ResultRecord,
  Store,
  WhyReplacement,
  WhyRunLog,
  WhyRunLogGap,
  WorktreeId,
} from "../types/index.js";

/*
 * Issue 15 (011-04, spec 011 C6 and C7): one row per check and key, so a
 * later run at a worktree's key, another worktree's with the same key
 * included, replaces the result behind its known state. `why` then says
 * whose result sits at the key and reads the state's own run log through
 * the producer the state sink recorded, or says why there is none.
 */

/**
 * The row at the current key when the known state is current and that row
 * is not the result behind it (`shown` is `null`), with its run's log
 * directory; `undefined` otherwise.
 */
export function replacement(
  store: Store,
  knownState: KnownState | null,
  key: CheckKey | null,
  all: readonly ResultRecord[],
  shown: ResultRecord | null,
): WhyReplacement | undefined {
  if (shown !== null || knownState?.validity !== "current" || key === null) return undefined;
  const atKey = all.find((r) => r.key === key);
  if (atKey === undefined) return undefined;
  const { runId, worktreeId, recordedAt } = atKey.provenance;
  return { runId, worktreeId, recordedAt, key, logDir: store.runs.get(runId)?.logDir ?? null };
}

/**
 * The run log when no stored result is the one behind the known state. A
 * failing state's producer (`readFailureProducers`) still names its run:
 * its log is read through the run record's `log_dir` (`logOf`) when that
 * run is the state's origin's, the sink recorded the failure at the state's
 * key, and it is not the run whose row now sits there. Otherwise why there
 * is none.
 */
export function unshownLog(
  store: Store,
  worktreeId: WorktreeId,
  knownState: KnownState | null,
  key: CheckKey | null,
  replaced: WhyReplacement | undefined,
  logOf: (run: { runId: string; worktreeId: WorktreeId }, logDir: AbsolutePath) => WhyRunLog,
): { runLog: WhyRunLog } | { runLog: null; runLogUnavailable: WhyRunLogGap } {
  const gap = (runLogUnavailable: WhyRunLogGap) => ({ runLog: null, runLogUnavailable });
  if (knownState === null) return gap("no-state");
  const origin = knownState.origin;
  if (origin === null) return gap("no-origin");
  const id = checkIdentity(knownState.check);
  const producer =
    knownState.outcome === "fail" ? readFailureProducers(store, worktreeId).get(id) : undefined;
  if (producer !== undefined && producer.runId !== replaced?.runId) {
    const failureKey = readFailureKeys(store, worktreeId).get(id);
    const named =
      failureKey !== undefined && (knownState.validity !== "current" || failureKey === key);
    const run = store.runs.get(producer.runId);
    const source = origin.kind === "inherited" ? origin.worktreeId : worktreeId;
    if (named && run === null) return gap("producer-pruned");
    if (named && run !== null && run.worktreeId === source) {
      const log = logOf({ runId: run.id, worktreeId: run.worktreeId }, run.logDir);
      return { runLog: { ...log, fromProducer: true } };
    }
  }
  if (replaced !== undefined) return gap("replaced");
  if (knownState.validity === "current" && key !== null) return gap("not-stored");
  return gap("unidentified");
}
