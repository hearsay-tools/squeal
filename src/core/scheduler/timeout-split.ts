import { isSlowLane, type RunReport } from "../types/index.js";
import { NOTHING_CHANGED } from "./context.js";
import type { FileState } from "./files.js";
import type { Ledger } from "./ledger.js";
import { priorityOf } from "./queue.js";

/**
 * The tier cap of the files a timed-out tier left incomplete (D5, D12; task
 * 001-179): half as many as it left so, down to one, so a file that holds
 * every tier it joins ends up in a tier of its own. `null` when the tier
 * held one file, which is `unknown` as before, or ran in a slow lane, whose
 * width spec 004 D2 sets; also when the run did not time out.
 */
export function timeoutCap(
  report: RunReport,
  lane: string,
  files: readonly FileState[],
  completed: ReadonlySet<string>,
): number | null {
  if (report.end !== "timed-out" || files.length < 2 || isSlowLane(lane)) return null;
  const incomplete = files.filter((file) => !completed.has(file.id)).length;
  return Math.max(1, Math.floor(incomplete / 2));
}

/** Queues `file` again under `cap`, keeping a smaller cap it already had. */
export function requeueSplit(
  ledger: Ledger,
  file: FileState,
  cap: number,
  forced: boolean,
  recent: boolean,
): void {
  file.tierCap = Math.min(cap, file.tierCap ?? cap);
  if (file.key === null || file.blocked !== null) return;
  ledger.enqueue(file, priorityOf(file, NOTHING_CHANGED), forced, recent);
}

/** Why a timed-out tier's files are `unknown`: "timed out after N s". */
export function timedOutReason(timeoutMs: number | null): string | null {
  return timeoutMs === null ? null : `timed out after ${timeoutMs / 1000} s`;
}
