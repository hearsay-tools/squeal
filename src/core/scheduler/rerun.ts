import type { CheckKey, ResultRecord } from "../types/index.js";
import { NOTHING_CHANGED, type SchedulerContext } from "./context.js";
import { checkId, type FileState } from "./files.js";
import type { Ledger } from "./ledger.js";
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

/**
 * Queues the re-run of `file`'s new failure at `key`, unless the run that
 * failed was forced (`run --all --force`, or a re-run itself), the key was
 * already re-run, or the file is slow (spec 004 D2: the slow tier runs a slow
 * file when its triggers say). Called after the results were applied.
 */
export function queueRerun(ledger: Ledger, file: FileState, key: CheckKey, forced: boolean): void {
  if (forced || file.rerunKey === key || ledger.queue.isSlow(file.ref)) return;
  file.rerunKey = key;
  ledger.enqueue(file, priorityOf(file, NOTHING_CHANGED), true);
}
