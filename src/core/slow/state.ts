import type { SlowTierActivity, Store, WorktreeId } from "../types/index.js";

/*
 * Spec 004 D8: what the slow tier of a worktree is doing, published by its
 * daemon (`SlowTier`) and read by headers and status, which need no daemon.
 * Only meaningful while a slow file is pending: readers take the store's
 * pending counts as the truth and this as the reason.
 */

/** `meta` key of a worktree's published slow-tier activity. */
export function slowTierMetaKey(worktreeId: WorktreeId): string {
  return `slow-tier:${worktreeId}`;
}

/** Publishes `activity`; `null` clears it. Writes only a change. */
export function publishSlowActivity(
  store: Store,
  worktreeId: WorktreeId,
  activity: SlowTierActivity | null,
): void {
  const key = slowTierMetaKey(worktreeId);
  const next = JSON.stringify(activity);
  const now = store.meta.get(key);
  if (now === next || (now === null && activity === null)) return;
  store.meta.set(key, next);
}

/** The published activity; `null` when none is, or it does not parse (a newer or older daemon). */
export function readSlowActivity(store: Store, worktreeId: WorktreeId): SlowTierActivity | null {
  const raw = store.meta.get(slowTierMetaKey(worktreeId));
  if (raw === null) return null;
  try {
    return toActivity(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

const WAITS: ReadonlySet<unknown> = new Set(["fast", "idle", "slot", "load"]);

function toActivity(value: unknown): SlowTierActivity | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.kind === "waiting" && WAITS.has(v.for)) {
    return { kind: "waiting", for: v.for as Extract<SlowTierActivity, { kind: "waiting" }>["for"] };
  }
  if (v.kind === "running" && typeof v.path === "string" && typeof v.since === "number") {
    const last = typeof v.lastDurationMs === "number" ? v.lastDurationMs : null;
    return { kind: "running", path: v.path, since: v.since, lastDurationMs: last };
  }
  return null;
}
