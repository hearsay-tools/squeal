import { listPaths } from "../core/text.js";
import type { QueuedRun } from "./status-at-report-queued.js";

/*
 * Rows 023-58 and 023-59 (dogfood round 7, W1 and W2): the lines of a
 * `status --at --wait` report, which asks nothing, that say what changed
 * while it waited and what it cannot ask itself.
 */

/**
 * Row 023-58 (W1): a join asks nothing, so the files one side has a result
 * for and the other side neither has nor runs say how to ask them.
 */
export function idleLines(run: QueuedRun, at: string): string[] {
  const { idle } = run;
  if (idle === undefined) return [];
  const command = `\`${idle.command}\``;
  const line = (n: number, queues: number | null, there: string, here: string) =>
    `${n} test file${n === 1 ? "" : "s"} with a result ${there} ${n === 1 ? "has" : "have"} none ${here}, and none is queued or running there; ${promise(command, n, queues)}`;
  const { queues } = idle;
  return [
    ...(idle.commit === 0
      ? []
      : [line(idle.commit, queues.commit, "in the working tree", `at ${at}`)]),
    ...(idle.now === 0
      ? []
      : [`now: ${line(idle.now, queues.now, `at ${at}`, "in the working tree")}`]),
  ];
}

/**
 * Review 0.1.607 B2: what `command` queues of `n` idle files, exactly as
 * the daemon's selection tells (`queues`), or that it queues the ones it
 * selects when no kept ask tells its selection (`null`).
 */
function promise(command: string, n: number, queues: number | null): string {
  const it = n === 1 ? "it" : "them";
  if (queues === null)
    return n === 1
      ? `${command} queues it if it selects it`
      : `${command} queues those of them it selects`;
  if (queues >= n) return `${command} queues ${it}`;
  if (queues === 0) return `${command} does not select ${n === 1 ? "it" : "any of them"}`;
  const other = n - queues;
  return `${command} queues ${queues} of them; it does not select the other ${other}`;
}

/** Row 023-59 (W2): the most paths a `--wait` names per side as now having a result. */
export const RESOLVED_SHOWN = 20;

/** Row 023-59 (W2): a join names the files that went from running to a result, per side. */
export function resolvedLines(run: QueuedRun, at: string): string[] {
  const { resolved } = run;
  if (resolved === undefined) return [];
  const line = (paths: readonly string[], where: string) =>
    `${paths.length} test file${paths.length === 1 ? "" : "s"} went from running to a result ${where}: ${listPaths(paths, RESOLVED_SHOWN)}`;
  return [
    ...(resolved.commit.length === 0 ? [] : [`--wait: ${line(resolved.commit, `at ${at}`)}`]),
    ...(resolved.now.length === 0
      ? []
      : [`--wait, now: ${line(resolved.now, "in the working tree")}`]),
  ];
}
