import type { CommitSha, EpochMs, WorktreeId } from "../types/common.js";
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

/*
 * Row 026-w2-r3 (review 0.1.617 B3): the marker's value also carries the
 * `HEAD` the start scan saw, as `<startedAt> <head>`, so a worktree whose
 * daemon left no revision (revision 0) still has a `HEAD` the no-daemon
 * staleness notice compares against (spec 026 D2.4). An unborn or unread
 * `HEAD` leaves the value the `startedAt` alone. A value written before the
 * row has no `HEAD`.
 */

/** The daemon started at `startedAt` finished its start scan, which saw `head`. */
export function markScanned(
  store: Pick<Store, "meta">,
  worktreeId: WorktreeId,
  startedAt: EpochMs,
  head: CommitSha = null,
): void {
  const value = head === null ? String(startedAt) : `${startedAt} ${head}`;
  store.meta.set(bootstrappedMetaKey(worktreeId), value);
}

function marker(store: Pick<Store, "meta">, worktreeId: WorktreeId): [string, string | undefined] {
  const [startedAt = "", head] = (store.meta.get(bootstrappedMetaKey(worktreeId)) ?? "").split(" ");
  return [startedAt, head];
}

/**
 * When the daemon that last finished its start scan started; `null` when
 * none is recorded or it is not a finite number.
 */
export function lastScannedBy(store: Pick<Store, "meta">, worktreeId: WorktreeId): EpochMs | null {
  const [startedAt] = marker(store, worktreeId);
  const value = startedAt === "" ? Number.NaN : Number(startedAt);
  return Number.isFinite(value) ? value : null;
}

/**
 * The `HEAD` the last finished start scan saw; `null` when none is recorded,
 * the marker is unreadable, or `HEAD` was unborn then.
 */
export function lastScannedHead(store: Pick<Store, "meta">, worktreeId: WorktreeId): CommitSha {
  if (lastScannedBy(store, worktreeId) === null) return null;
  return marker(store, worktreeId)[1] || null;
}

/** Whether the daemon started at `startedAt` finished its start scan. */
export function scannedBy(
  store: Pick<Store, "meta">,
  worktreeId: WorktreeId,
  startedAt: EpochMs,
): boolean {
  return lastScannedBy(store, worktreeId) === startedAt;
}
