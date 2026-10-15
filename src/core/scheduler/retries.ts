import { worktreeLiveness } from "../delivery/liveness.js";
import {
  claimRetries,
  endRetries,
  hostLoad,
  loadAllows,
  perCpu,
  type RetryOutcome,
  readRetries,
  recordRunLoad,
  releaseRetries,
} from "../retry/index.js";
import type { CheckKey, ResultRecord } from "../types/index.js";
import { NOTHING_CHANGED, type SchedulerContext } from "./context.js";
import type { FileState } from "./files.js";
import type { Ledger } from "./ledger.js";
import { priorityOf } from "./queue.js";

/*
 * Spec 001 D6 as amended (001-348, scope 001-368): the agent's `squeal retry`
 * is a request in the shared store. A daemon whose file is at the request's
 * key claims it and queues one forced run: at once for `environment`, once
 * the one-minute load is below the CPU count for `load`, looked at in every
 * reconciliation pass until then, however long that takes. The run's result
 * replaces the row (D8) and ends every pending request at the key. A file
 * whose key moves gives its claim back; the request lapses for this worktree.
 */

/** The host's load as the scheduler reads it. */
export function loadOf(context: SchedulerContext) {
  return (context.hostLoad ?? hostLoad)();
}

/**
 * Under the lock: claims and queues the pending requests at this worktree's
 * keys that may run now, and drops a queued retry whose request was
 * withdrawn. Returns whether the queue changed.
 */
export function takeRetries(context: SchedulerContext, ledger: Ledger): boolean {
  const { store, worktreeId } = context;
  const pending = readRetries(store).filter((r) => r.end === null);
  let changed = false;
  for (const file of ledger.files.values()) {
    if (file.retryKey === null || file.runningKey !== null) continue;
    if (pending.some((r) => r.key === file.retryKey && sameFile(r.testFile, file))) continue;
    file.retryKey = null;
    if (!file.rerunPending) changed = ledger.dequeue(file) || changed;
  }
  const due = new Map<string, { file: FileState; key: CheckKey; now: boolean }>();
  for (const request of pending) {
    const file = ledger.file(request.testFile);
    if (!file || file.key !== request.key || file.retryKey === request.key) continue;
    if (file.blocked !== null) continue;
    const entry = due.get(file.id) ?? { file, key: request.key, now: false };
    entry.now ||= request.reason === "environment";
    due.set(file.id, entry);
  }
  if (due.size === 0) return changed;
  const loadLow = [...due.values()].every((d) => d.now) || loadAllows(loadOf(context));
  const at = context.now();
  const live = (id: string) => worktreeLiveness(store.worktrees.get(id), at).state === "alive";
  for (const { file, key, now } of due.values()) {
    if (!now && !loadLow) continue;
    if (!claimRetries(store, file.ref, key, worktreeId, at, live)) continue;
    file.retryKey = key;
    ledger.enqueue(file, priorityOf(file, NOTHING_CHANGED), true);
    changed = true;
  }
  return changed;
}

function sameFile(ref: FileState["ref"], file: FileState): boolean {
  return ref.project === file.ref.project && ref.path === file.ref.path;
}

/**
 * In `recordTier`: a forced run of `file` at its retry's key ended the
 * requests there, `passed` or `failed` by its records, `unknown` when it
 * gave no result.
 */
export function endRetry(
  context: SchedulerContext,
  file: FileState,
  key: CheckKey,
  records: readonly ResultRecord[] | null,
): void {
  if (file.retryKey !== key) return;
  file.retryKey = null;
  const outcome: RetryOutcome =
    records === null ? "unknown" : records.some((r) => r.outcome === "fail") ? "failed" : "passed";
  endRetries(context.store, file.ref, key, {
    outcome,
    at: context.now(),
    worktreeId: context.worktreeId,
  });
}

/** In `Ledger.settle`: the file's key moved from its retry's, so its claim goes back. */
export function lapseRetry(context: SchedulerContext, file: FileState, key: CheckKey | null) {
  if (file.retryKey === null || file.retryKey === key) return false;
  file.retryKey = null;
  releaseRetries(context.store, file.ref, context.worktreeId);
  return true;
}

/** The load per CPU a tier starts under, for `recordFailedLoad`. */
export function tierLoad(context: SchedulerContext): number | null {
  return perCpu(loadOf(context));
}

/**
 * Keeps the load per CPU of a run that stored a failure (001-368): an
 * inherited failure states it.
 */
export function recordFailedLoad(
  context: SchedulerContext,
  runId: string,
  load: number | null,
  records: readonly ResultRecord[],
): void {
  if (load === null || !records.some((r) => r.outcome === "fail")) return;
  recordRunLoad(context.store, runId, load);
}
