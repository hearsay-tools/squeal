import { NOTHING_CHANGED } from "./context.js";
import type { FileState } from "./files.js";
import type { Ledger } from "./ledger.js";
import { priorityOf } from "./queue.js";

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
