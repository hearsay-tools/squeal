import type { RevisionNumber, WorktreeId } from "../../core/types/common.js";
import {
  awaitingInstallMetaKey,
  type CheckpointProgress,
  checkpointMetaKey,
  installCommandMetaKey,
  parseAwaitingInstall,
  parseCheckpointProgress,
} from "../../core/types/scheduler.js";
import type { Store } from "../../core/types/store.js";
import type { CheckpointEnd } from "../../core/types/store-records.js";

/*
 * Row 011-326 (`research/waits.md`, "Progress reads"; card 4's seam): the
 * daemon's progress records a run wait reads, through today's parsers, with
 * no meaning added. Card 4 replaces these reads and nothing else.
 */

/** How checkpoint `id` ended; `null` while it runs, or when the store holds no record of it. */
export function checkpointEnd(store: Store, id: string): CheckpointEnd | null {
  return store.checkpoints.get(id)?.end ?? null;
}

/** The worktree's open checkpoint and what it has done (`checkpointMetaKey`), `null` with none. */
export function openCheckpoint(store: Store, worktreeId: WorktreeId): CheckpointProgress | null {
  return parseCheckpointProgress(store.meta.get(checkpointMetaKey(worktreeId)));
}

/** The worktree's latest revision, 0 before the first. */
export function latestRevision(store: Store, worktreeId: WorktreeId): RevisionNumber {
  return store.revisions.latest(worktreeId)?.number ?? 0;
}

/**
 * Review 0.1.411-r2 (row 019-52): the worktree waits for an install, so
 * none of its files runs; `command` installs the dependencies, `null` when
 * the daemon names none.
 */
export interface InstallHold {
  readonly command: string | null;
}

/** The install the worktree waits for (`parseAwaitingInstall`), with the command that ends it; `null`: none. */
export function installWait(store: Store, worktreeId: WorktreeId): InstallHold | null {
  if (parseAwaitingInstall(store.meta.get(awaitingInstallMetaKey(worktreeId))) === null) {
    return null;
  }
  const command = store.meta.get(installCommandMetaKey(worktreeId));
  return { command: command === "" ? null : command };
}
