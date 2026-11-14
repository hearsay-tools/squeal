import type { WorktreeId } from "../types/common.js";
import type { CheckpointProgress } from "../types/scheduler.js";
import { type Store, worktreeMetaKey } from "../types/store.js";

/*
 * Row 011-339 (`research/progress-records.md`): the checkpoint progress, its
 * one owner. A worktree's open checkpoint and its progress, a JSON
 * `CheckpointProgress` (task 001-217): status names a checkpoint in progress
 * from it. Written by the scheduler's checkpoint tracker as its files get
 * results; `""` once it ended. With `owed`, the daemon stopped before an
 * explicit checkpoint ended and the next daemon resumes it (task 001-219).
 */

function checkpointMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("checkpoint", worktreeId);
}

/** The worktree's open checkpoint, or `null` when none is recorded, it ended or it is not readable. */
export function readCheckpointProgress(
  store: Pick<Store, "meta">,
  worktreeId: WorktreeId,
): CheckpointProgress | null {
  const raw = store.meta.get(checkpointMetaKey(worktreeId));
  if (raw === null || !raw.startsWith("{")) return null;
  try {
    const value = JSON.parse(raw) as Partial<CheckpointProgress>;
    const numbers = [value.revision, value.startedAt, value.done, value.total];
    if (typeof value.id !== "string" || numbers.some((n) => typeof n !== "number")) return null;
    if (value.kind !== "run-all" && value.kind !== "baseline") return null;
    const owed = value.owed;
    const lists = owed === undefined ? [] : [owed.ids, owed.remaining, owed.strict];
    if (!lists.every(Array.isArray)) return null;
    return value as CheckpointProgress;
  } catch {
    return null;
  }
}

/** The open checkpoint's progress changed; `null`: it ended. */
export function writeCheckpointProgress(
  store: Pick<Store, "meta">,
  worktreeId: WorktreeId,
  progress: CheckpointProgress | null,
): void {
  store.meta.set(checkpointMetaKey(worktreeId), progress === null ? "" : JSON.stringify(progress));
}
