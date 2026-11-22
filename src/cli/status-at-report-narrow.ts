import type { QueuedRun, QueuedSide } from "./status-at-report-queued.js";

/*
 * Rows 023-51 and 023-52 (dogfood round 6, V4 and V6): the lines of a
 * `status --at --run` or `--wait` report that tell a narrowed call's own
 * files apart from the rest of each daemon's queue, and a failed setup on
 * one side apart from the same files on the other.
 */

/** Row 023-52 (V6): `; in the working tree 97 of them are still queued or running, 0 have a result`. */
export function elsewhereText(failed: QueuedSide["setupFailed"][number], there: string): string {
  const e = failed.elsewhere;
  if (e === undefined) return "";
  if (e.running + e.known === 0)
    return `; ${there} they have no result, and none is queued or running`;
  const parts = [
    ...(e.running === 0 ? [] : [`${e.running} still queued or running (the same setup may fail)`]),
    ...(e.known === 0 ? [] : [`${e.known} with a result`]),
  ];
  return `; ${there}, of them: ${parts.join(", ")}`;
}

/**
 * Row 023-52 (V6): of the files still running on one side, those whose
 * batch's setup failed on `failed`'s side in this call:
 * `97 of them in a batch whose setup failed at <c>`; empty when none.
 */
export function failedThere(failed: QueuedSide, where: string): string {
  const n = failed.setupFailed.reduce((sum, f) => sum + (f.elsewhere?.running ?? 0), 0);
  return n === 0 ? "" : `${n} of them in a batch whose setup failed ${where}`;
}

/**
 * Row 023-51 (V4): a narrowed call's files first, before the rest of the
 * queue: `test/store: 35 of 36 still running at <c>, 0 of 38 in the working
 * tree`; `null` without paths, or when nothing runs.
 */
export function namedLine(run: QueuedRun, at: string): string | null {
  if (run.paths === undefined || run.paths.length === 0) return null;
  const { commit, now } = run;
  const setup = commit.setup ?? null;
  if (setup === null && now.setup !== true && commit.running + now.running === 0) return null;
  const of = (side: QueuedSide, where: string) =>
    side.files === 0
      ? `none queued ${where}`
      : `${side.running} of ${side.files} still running ${where}`;
  const there = setup === null ? of(commit, `at ${at}`) : `still setting up at ${at} (${setup})`;
  const here =
    now.setup === true ? "still setting up in the working tree" : of(now, "in the working tree");
  return `${run.paths.join(", ")}: ${there}, ${here}`;
}

/** Row 023-51 (V4): the rest of each daemon's queue, on its own line; `null` when none. */
export function restLine(run: QueuedRun, at: string): string | null {
  const there = run.commit.rest ?? 0;
  const here = run.now.rest ?? 0;
  if (there + here === 0) return null;
  const outside = run.paths === undefined ? "this call's files" : "these paths";
  return `The rest of the queue, outside ${outside}: ${there} more test files queued or running at ${at} (its worktree), ${here} in the working tree`;
}
