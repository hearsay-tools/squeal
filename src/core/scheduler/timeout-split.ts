import type { CheckKey } from "../types/index.js";
import { NOTHING_CHANGED } from "./context.js";
import type { FileState } from "./files.js";
import type { Ledger } from "./ledger.js";
import { priorityOf } from "./queue.js";

/**
 * Queues `file`, which a tier ran at `key`, again under `cap`, keeping a
 * smaller cap it already had; forced only while `Ledger.staysForced` holds.
 */
export function requeueSplit(
  ledger: Ledger,
  file: FileState,
  key: CheckKey,
  cap: number,
  forced: boolean,
  recent: boolean,
): void {
  file.tierCap = Math.min(cap, file.tierCap ?? cap);
  if (file.key === null || file.blocked !== null) return;
  ledger.enqueue(
    file,
    priorityOf(file, NOTHING_CHANGED),
    ledger.staysForced(file, key, forced),
    recent,
  );
}

/** Why a timed-out tier's files are `unknown`: "timed out after N s". */
export function timedOutReason(timeoutMs: number | null): string | null {
  return timeoutMs === null ? null : `timed out after ${timeoutMs / 1000} s`;
}
