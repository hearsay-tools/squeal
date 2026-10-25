import type { RevisionNumber } from "../../types/index.js";
import { type cursorOf, takeAwaited, writeCursor, writeRecount } from "./cursor.js";
import { type FailedCounts, writeUncountable } from "./failed.js";
import type { Judged } from "./judge.js";
import { type ListedRecord, writeListed } from "./listed.js";
import type { PassContext } from "./pass.js";
import type { PassReport, RecountReason } from "./types.js";

/* Spec 015 D4: what a pass's last transaction writes beside the states, and what it reports. */

/** What the last transaction writes beside the states. */
export interface End {
  readonly latest: RevisionNumber;
  readonly reason: RecountReason | null;
  readonly current: ReturnType<typeof cursorOf>;
  readonly counted: number;
  readonly failed: FailedCounts;
  readonly listed: ListedRecord;
}

/**
 * The last transaction's meta: the cursor, the listing's record, the failed
 * counts, and a recount's record. The coordinator's contract with 015-07: a
 * first pass over inherited counts writes none, unless a consumer
 * registered before it and was told counting (015-35).
 */
export function writeEnd(ctx: PassContext, end: End): void {
  const { store, worktreeId } = ctx;
  const { latest, reason, counted } = end;
  writeCursor(store.meta, worktreeId, end.current);
  writeListed(store.meta, worktreeId, end.listed);
  writeUncountable(store.meta, worktreeId, end.failed);
  const awaited = reason === "first" && takeAwaited(store.meta, worktreeId);
  if (reason !== null && (reason !== "first" || counted > 0 || ctx.switchedOn || awaited)) {
    writeRecount(store.meta, worktreeId, {
      revision: latest,
      at: ctx.now(),
      reason,
      threshold: ctx.complexity.threshold,
    });
  }
}

/** What one pass did. */
export function report(
  revision: RevisionNumber,
  reason: RecountReason | null,
  files: number,
  counted: number,
  judged: Omit<Judged, "states">,
): PassReport {
  return {
    revision,
    mode: reason ?? "edit",
    files,
    counted,
    transitions: judged.transitions.length,
    moved: judged.moves.length,
    moves: judged.moves,
    removed: judged.removed,
    edited: judged.edited,
  };
}
