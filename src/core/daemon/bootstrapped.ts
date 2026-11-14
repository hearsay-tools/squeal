import type { EpochMs, WorktreeId } from "../types/common.js";
import { type Store, worktreeMetaKey } from "../types/store.js";

/*
 * Row 011-339 (`research/progress-records.md`): the bootstrap marker, its
 * one owner. The `DaemonRecord.startedAt` of the daemon that finished its
 * start scan (`bootstrap`). The scan hashes files it has no hash for without
 * a revision, so an edit made before it can be in no revision; a consumer
 * registered while the marker matches the live daemon may be told "none of
 * the files changed here" while that daemon lives (task 001-96, review wave
 * 10c). No hook waits for it. A progress record, not a presence event.
 */

function bootstrappedMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("daemonBootstrapped", worktreeId);
}

/** The daemon started at `startedAt` finished its start scan. */
export function markScanned(
  store: Pick<Store, "meta">,
  worktreeId: WorktreeId,
  startedAt: EpochMs,
): void {
  store.meta.set(bootstrappedMetaKey(worktreeId), String(startedAt));
}

/**
 * When the daemon that last finished its start scan started; `null` when
 * none is recorded or it is not a finite number.
 */
export function lastScannedBy(store: Pick<Store, "meta">, worktreeId: WorktreeId): EpochMs | null {
  const marker = store.meta.get(bootstrappedMetaKey(worktreeId));
  const value = marker === null ? Number.NaN : Number(marker);
  return Number.isFinite(value) ? value : null;
}

/** Whether the daemon started at `startedAt` finished its start scan. */
export function scannedBy(
  store: Pick<Store, "meta">,
  worktreeId: WorktreeId,
  startedAt: EpochMs,
): boolean {
  return lastScannedBy(store, worktreeId) === startedAt;
}
