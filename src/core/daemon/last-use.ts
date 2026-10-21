import { isRecord } from "../fs/index.js";
import type { EpochMs, Store, WorktreeId } from "../types/index.js";
import { worktreeMetaKey } from "../types/index.js";

/*
 * Spec 014 D9 (row 014-08): the past-idle and past-unused rules of `squeal
 * ps` need the time the daemon was last used, which only its memory held
 * (`#lastUsed`, `#lastActive`). With each heartbeat the daemon writes both,
 * `{ v: 1, usedAt, activeAt }`, in its worktree's `daemonUsed` row of `meta`.
 * The row needs no migration, and a daemon of a release without it writes
 * none.
 */

/** When the daemon was last used and last active (011 C9's unused and idle rules). */
export interface DaemonUsed {
  /** Its start, an edit, a tier queued or running, a wait or a request. */
  readonly usedAt: EpochMs;
  /** Its start, a request or a registered consumer. */
  readonly activeAt: EpochMs;
}

/** `meta` key of the worktree's last use. */
export function daemonUsedMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("daemonUsed", worktreeId);
}

/** Records `used` for the worktree, in the caller's write. */
export function recordDaemonUsed(store: Store, worktreeId: WorktreeId, used: DaemonUsed): void {
  const value = { v: 1, usedAt: used.usedAt, activeAt: used.activeAt };
  store.meta.set(daemonUsedMetaKey(worktreeId), JSON.stringify(value));
}

/**
 * The last use a `daemonUsed` row holds; `null` for no value and for any
 * value it does not know: not JSON, not `v: 1`, or a time that is not a
 * non-negative integer. Keys beside its own are left alone.
 */
export function readDaemonUsed(value: string | null): DaemonUsed | null {
  if (value === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.v !== 1) return null;
  const { usedAt, activeAt } = parsed;
  if (!isEpochMs(usedAt) || !isEpochMs(activeAt)) return null;
  return { usedAt, activeAt };
}

function isEpochMs(value: unknown): value is EpochMs {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
