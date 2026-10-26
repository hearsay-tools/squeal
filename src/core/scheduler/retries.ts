import { worktreeLiveness } from "../delivery/liveness.js";
import {
  claimRetries,
  endRetries,
  hostLoad,
  loadAllows,
  loadRetryDue,
  loadRetryNoteText,
  markGateClosed,
  perCpu,
  type RetryOutcome,
  type RetryRecord,
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
 * reconciliation pass until then, or once `LOAD_RETRY_WAIT_MS` has passed
 * since a look first met that gate closed, with a load note (011 C5 as
 * amended, row 011-213); a request for a file with no result at its key at
 * once whatever its reason (011 C5, gh-36). The run's result
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
  // An earlier daemon's claim on a file no longer at its key here, gone or re-keyed while no daemon ran, goes back (S1).
  for (const request of pending) {
    if (request.claim?.worktreeId !== worktreeId) continue;
    const file = ledger.file(request.testFile);
    if (file?.key === request.key) continue;
    releaseRetries(store, request.testFile, worktreeId, file?.key ?? null);
  }
  const dropped = dropWithdrawn(ledger, pending);
  return queueDue(context, ledger, pending) || dropped;
}

/** A queued retry whose request was withdrawn leaves the queue, unless its 001-171 re-run is still to come. */
function dropWithdrawn(ledger: Ledger, pending: readonly RetryRecord[]): boolean {
  let changed = false;
  for (const file of ledger.files.values()) {
    if (file.retryKey === null || file.runningKey !== null) continue;
    if (pending.some((r) => r.key === file.retryKey && sameFile(r.testFile, file))) continue;
    file.retryKey = null;
    if (!file.rerunPending) changed = ledger.dequeue(file) || changed;
  }
  return changed;
}

interface Due {
  readonly file: FileState;
  readonly key: CheckKey;
  /** It runs at once: an `environment` request, or one for a file with no result. */
  now: boolean;
}

/** The files at a pending request's key here, not queued for it yet nor blocked. */
function dueOf(ledger: Ledger, pending: readonly RetryRecord[]): Map<string, Due> {
  const due = new Map<string, Due>();
  for (const request of pending) {
    const file = ledger.file(request.testFile);
    if (!file || file.key !== request.key || file.retryKey === request.key) continue;
    if (file.blocked !== null) continue;
    const entry = due.get(file.id) ?? { file, key: request.key, now: false };
    entry.now ||= request.reason === "environment" || request.noResult === true;
    due.set(file.id, entry);
  }
  return due;
}

/**
 * Claims and queues each due file that may run now: at once, under the load
 * gate, or once the gate has been closed on it for `LOAD_RETRY_WAIT_MS`
 * (row 011-213), when the daemon notes the load it was queued under.
 */
function queueDue(
  context: SchedulerContext,
  ledger: Ledger,
  pending: readonly RetryRecord[],
): boolean {
  const { store, worktreeId } = context;
  const due = dueOf(ledger, pending);
  if (due.size === 0) return false;
  const load = [...due.values()].every((d) => d.now) ? null : loadOf(context);
  const closed = load !== null && !loadAllows(load);
  const at = context.now();
  const live = (id: string) => worktreeLiveness(store.worktrees.get(id), at).state === "alive";
  let changed = false;
  for (const { file, key, now } of due.values()) {
    const bounded = closed && !now;
    if (bounded && !loadRetryDue(markGateClosed(store, pending, file.ref, key, at), at)) continue;
    if (!claimRetries(store, file.ref, key, worktreeId, at, live)) continue;
    file.retryKey = key;
    ledger.enqueue(file, priorityOf(file, NOTHING_CHANGED), true);
    if (bounded) context.note(loadRetryNoteText(file.ref.path, perCpu(load) ?? 0));
    changed = true;
  }
  return changed;
}

function sameFile(ref: FileState["ref"], file: FileState): boolean {
  return ref.project === file.ref.project && ref.path === file.ref.path;
}

/**
 * In `recordTier`: a forced run of `file` at its retry's key, `runId`,
 * ended the requests there, `passed` or `failed` by its records, `unknown`
 * when it gave no result.
 */
export function endRetry(
  context: SchedulerContext,
  file: FileState,
  key: CheckKey,
  records: readonly ResultRecord[] | null,
  runId: string,
): void {
  if (file.retryKey !== key) return;
  file.retryKey = null;
  const outcome: RetryOutcome =
    records === null ? "unknown" : records.some((r) => r.outcome === "fail") ? "failed" : "passed";
  endRetries(context.store, file.ref, key, {
    outcome,
    at: context.now(),
    worktreeId: context.worktreeId,
    runId,
  });
}

/** In `Ledger.settle`: the file's key moved from its retry's, so its claim goes back. */
export function lapseRetry(context: SchedulerContext, file: FileState, key: CheckKey | null) {
  if (file.retryKey === null || file.retryKey === key) return false;
  file.retryKey = null;
  releaseRetries(context.store, file.ref, context.worktreeId);
  return true;
}

/**
 * In `Ledger.removeFile`: the file is gone here, so its claim goes back and
 * another daemon at the key may run the request (review 001-398, S1).
 */
export function dropRetry(context: SchedulerContext, file: FileState): void {
  if (file.retryKey === null) return;
  file.retryKey = null;
  releaseRetries(context.store, file.ref, context.worktreeId);
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
