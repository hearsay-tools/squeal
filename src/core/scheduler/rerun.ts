import type { CheckKey, ResultRecord } from "../types/index.js";
import { NOTHING_CHANGED, type SchedulerContext } from "./context.js";
import { checkId, type FileState } from "./files.js";
import type { Ledger } from "./ledger.js";
import { listPaths } from "./notes.js";
import { priorityOf } from "./queue.js";

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
 * `SchedulerOptions.rerunCap`'s default: the most new failures of one tier
 * that are re-run. Unbounded until the human decides a cap.
 */
export const RERUN_CAP = Number.POSITIVE_INFINITY;

/**
 * Queues the re-run of a tier's new failures, called once the tier's results
 * are applied. A failure is not re-run when its run was forced, its key was
 * already re-run, or its file is slow (a limit: a slow run can cost minutes
 * to an hour; the slow tier runs it again when spec 004 D2's triggers say).
 * When more than `rerunCap` are left, none is re-run and a note says why: a
 * failure that wide is rarely caused by load, and re-running it doubles the
 * tier.
 */
export function queueReruns(
  context: Pick<SchedulerContext, "note" | "rerunCap">,
  ledger: Ledger,
  failures: readonly NewFailure[],
): void {
  const due = failures.filter(
    ({ file, key, forced }) => !forced && file.rerunKey !== key && !ledger.queue.isSlow(file.ref),
  );
  if (due.length === 0) return;
  if (due.length > context.rerunCap) {
    const files = due.length === 1 ? "test file" : "test files";
    context.note(
      `${due.length} ${files} failed anew in one tier, above the re-run cap of ` +
        `${context.rerunCap} per tier: none is re-run, since a failure that wide is rarely ` +
        `caused by load (${listPaths(due.map(({ file }) => file.ref.path))})`,
    );
    return;
  }
  for (const { file, key } of due) {
    file.rerunKey = key;
    ledger.enqueue(file, priorityOf(file, NOTHING_CHANGED), true);
  }
}
