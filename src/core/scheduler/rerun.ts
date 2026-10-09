import type { CheckKey, ResultRecord } from "../types/index.js";
import { NOTHING_CHANGED, type SchedulerContext } from "./context.js";
import { checkId, type FileState } from "./files.js";
import type { Ledger } from "./ledger.js";
import { listPaths } from "./notes.js";
import { priorityOf } from "./queue.js";
import { pruneReruns, type RerunMemory, readReruns, writeReruns } from "./rerun-memory.js";

/*
 * Spec 001 D6 as amended (task 001-171, decided by the human 2026-10-09): a
 * worktree's own new failure is reported at once, then its file is re-run
 * once in the next tier, forced, at its normal D5 priority. A pass replaces
 * the row and is reported `FAIL -> PASS` with the flaky note
 * (`storeResults`); a fail again replaces a fail and is no news.
 */

/**
 * Whether a run's `records` of one file, just stored over `prior` (what the
 * key held before), hold a new failure of this worktree: a `fail` whose
 * check's known state here was not a fail (a pass, `unknown`, `skip` or
 * none, D6's `pass -> fail` and first-seen fail), and whose row under the
 * key was not a fail. A fail that replaces another worktree's fail confirms
 * an inherited failure (task 001-170): two runs failed, and it is not re-run.
 */
export function holdsNewFailure(
  context: SchedulerContext,
  prior: readonly ResultRecord[],
  records: readonly ResultRecord[],
): boolean {
  const { store, worktreeId } = context;
  const failed = new Set(prior.filter((p) => p.outcome === "fail").map((p) => checkId(p.check)));
  return records.some(
    (r) =>
      r.outcome === "fail" &&
      !failed.has(checkId(r.check)) &&
      store.knownStates.get(worktreeId, r.check)?.outcome !== "fail",
  );
}

/** A file whose run in a tier stored a new failure (`holdsNewFailure`) at `key`. */
export interface NewFailure {
  readonly file: FileState;
  readonly key: CheckKey;
  /** The tier ran it forced: `run --all --force`, or a re-run itself. */
  readonly forced: boolean;
}

/**
 * `SchedulerOptions.rerunCap`'s default, decided by the human (2026-10-09):
 * the most new failures of one tier that are re-run. A wider failure is a
 * mass break, rarely caused by load, and re-running it would double the tier.
 */
export const RERUN_CAP = 8;

/**
 * Queues the re-run of a tier's new failures, called once the tier's results
 * are applied. A failure is not re-run when its run was forced, its key was
 * already re-run, or its file is slow (a limit: a slow run can cost minutes
 * to an hour; the slow tier runs it again when spec 004 D2's triggers say).
 * When more than `rerunCap` are left, none is re-run and one note says how
 * many failed anew and that a mass break is not re-run. Returns the
 * failures queued, for `writeReruns` (review wave 13i, S1).
 */
export function queueReruns(
  context: Pick<SchedulerContext, "note" | "rerunCap">,
  ledger: Ledger,
  failures: readonly NewFailure[],
): NewFailure[] {
  const due = failures.filter(
    ({ file, key, forced }) => !forced && file.rerunKey !== key && !ledger.queue.isSlow(file.ref),
  );
  if (due.length === 0) return [];
  if (due.length > context.rerunCap) {
    const files = due.length === 1 ? "test file" : "test files";
    context.note(
      `${due.length} ${files} failed anew in one tier, more than the ${context.rerunCap} ` +
        "Squeal re-runs: a mass break is not re-run " +
        `(${listPaths(due.map(({ file }) => file.ref.path))})`,
    );
    return [];
  }
  for (const { file, key } of due) {
    file.rerunKey = key;
    file.rerunPending = true;
    ledger.enqueue(file, priorityOf(file, NOTHING_CHANGED), true);
  }
  return due;
}

/** Remembers the re-runs `queueReruns` queued, pending, in `meta` (S1). */
export function rememberReruns(context: SchedulerContext, queued: readonly NewFailure[]): void {
  const entries = queued.map(({ file, key }) => ({ testFile: file.ref, key, pending: true }));
  writeReruns(context.store, context.worktreeId, entries);
}

/**
 * The pending re-run of `file` is over: it ran forced at `key` and stored
 * (`landed`), or the file's key moved before it ran, when the run at the
 * new key is an ordinary one (`Ledger.settle`). The key stays remembered.
 */
export function endRerun(context: SchedulerContext, file: FileState): void {
  if (!file.rerunPending || file.rerunKey === null) return;
  file.rerunPending = false;
  writeReruns(context.store, context.worktreeId, [
    { testFile: file.ref, key: file.rerunKey, pending: false },
  ]);
}

/**
 * At the baseline (review wave 13i, S1): each listed file takes the key its
 * new failure was re-run at, and a re-run a daemon queued and never ran is
 * queued forced again while the file is still at that key. Under a
 * lookup-only baseline (`queue` false) it stays pending for a later daemon.
 * A file no longer listed is forgotten.
 */
export function restoreReruns(context: SchedulerContext, ledger: Ledger, queue: boolean): void {
  const { store, worktreeId } = context;
  const ended: RerunMemory[] = [];
  for (const [id, memory] of readReruns(store, worktreeId)) {
    const file = ledger.files.get(id);
    if (!file) continue;
    file.rerunKey = memory.key;
    if (!memory.pending) continue;
    if (file.key !== memory.key || ledger.queue.isSlow(file.ref)) {
      ended.push({ ...memory, pending: false });
    } else if (queue) {
      file.rerunPending = true;
      ledger.enqueue(file, priorityOf(file, NOTHING_CHANGED), true);
    }
  }
  writeReruns(store, worktreeId, ended);
  pruneReruns(store, worktreeId, new Set(ledger.files.keys()));
}
