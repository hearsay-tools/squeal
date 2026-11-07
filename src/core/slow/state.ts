import type { WorktreeId } from "../types/common.js";
import type { CheckKey } from "../types/keys.js";
import { SLOW_GROUP } from "../types/scheduler.js";
import type { SlowTierActivity } from "../types/status.js";
import { type Store, worktreeMetaKey } from "../types/store.js";

/*
 * Spec 004 D8: what the slow tier of a worktree is doing, published by its
 * daemon (`SlowTier`) and read by headers and status, which need no daemon.
 * Only meaningful while a slow file is pending: readers take the store's
 * pending counts as the truth and this as the reason.
 */

/** `meta` key of a worktree's published slow-tier activity. */
export function slowTierMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("slowTier", worktreeId);
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
    return toSlowActivity(JSON.parse(raw) as unknown) ?? null;
  } catch {
    return null;
  }
}

/**
 * Spec 019 D3, wave 2's activity contract (coordinator, 2026-11-03): the
 * `meta` key of the lane activity of a worktree's configured groups, one
 * row whose value maps a group's name to its `SlowTierActivity`. The
 * default `slow` group keeps its own row (`slowTierMetaKey`).
 */
export function groupTiersMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("groupTiers", worktreeId);
}

/**
 * `publishSlowActivity` for group `group`'s lane: the default `slow`
 * group's row, or `group`'s entry in the configured groups' row, which
 * `null` removes (a row left empty goes). Writes only a change.
 */
export function publishGroupActivity(
  store: Store,
  worktreeId: WorktreeId,
  group: string,
  activity: SlowTierActivity | null,
): void {
  if (group === SLOW_GROUP) {
    publishSlowActivity(store, worktreeId, activity);
    return;
  }
  const key = groupTiersMetaKey(worktreeId);
  const raw = store.meta.get(key);
  const entries = groupEntries(raw);
  if (JSON.stringify(entries[group] ?? null) === JSON.stringify(activity)) return;
  const { [group]: _, ...others } = entries;
  const next = activity === null ? others : { ...others, [group]: activity };
  if (Object.keys(next).length > 0) store.meta.set(key, JSON.stringify(next));
  else if (raw !== null) store.meta.delete(key);
}

/** `readSlowActivity` for group `group`'s lane. */
export function readGroupActivity(
  store: Store,
  worktreeId: WorktreeId,
  group: string,
): SlowTierActivity | null {
  if (group === SLOW_GROUP) return readSlowActivity(store, worktreeId);
  return (
    toSlowActivity(groupEntries(store.meta.get(groupTiersMetaKey(worktreeId)))[group] ?? null) ??
    null
  );
}

/** The configured groups' row by name; empty when absent or in a format this release does not know. */
function groupEntries(raw: string | null): Record<string, unknown> {
  if (raw === null) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const WAITS: ReadonlySet<unknown> = new Set(["fast", "idle", "slot", "pool", "load"]);

/**
 * A `slowTier` row's parsed value: `null` when none is published, `undefined`
 * in a format this release does not know.
 */
export function toSlowActivity(value: unknown): SlowTierActivity | null | undefined {
  if (value === null) return null;
  if (typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (v.kind === "waiting" && WAITS.has(v.for)) {
    return { kind: "waiting", for: v.for as Extract<SlowTierActivity, { kind: "waiting" }>["for"] };
  }
  if (v.kind === "running" && typeof v.path === "string" && typeof v.since === "number") {
    const last = typeof v.lastDurationMs === "number" ? v.lastDurationMs : null;
    const paths: unknown[] = Array.isArray(v.paths) ? v.paths : [];
    const several = paths.length > 1 && paths.every((p) => typeof p === "string");
    return {
      kind: "running",
      path: v.path,
      ...(several ? { paths: paths as string[] } : {}),
      since: v.since,
      lastDurationMs: last,
    };
  }
  return undefined;
}

/*
 * Review wave 2.5 B1: which result a worktree's failing known state holds,
 * by the key it was stored under, so a failure names its own run's key
 * while it is current, pending or stale. A key state is not
 * recorded with the state, and a commit or failure fingerprint does not
 * identify a run. Written by the state sink in the transaction that applies
 * the result.
 */

/** `meta` key of the keys a worktree's failing states' results were stored under. */
export function failureKeysMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("failureKeys", worktreeId);
}

/** The newest failing checks whose key a worktree keeps; an older one reads as unknown. */
export const FAILURE_KEYS_KEPT = 1_024;

/**
 * The key of the result each failing check of `worktreeId` holds, by
 * `checkIdentity`, oldest first. Empty when none is recorded or the row does
 * not parse.
 */
export function readFailureKeys(
  store: Store,
  worktreeId: WorktreeId,
): ReadonlyMap<string, CheckKey> {
  const raw = store.meta.get(failureKeysMetaKey(worktreeId));
  if (raw === null) return new Map();
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return new Map();
    return new Map(
      Object.entries(value).filter(
        (entry): entry is [string, CheckKey] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return new Map();
  }
}

/**
 * Records the key of the result each check's state now holds, a failing
 * one; `null` forgets a check whose state holds no failure. Keeps the newest
 * `FAILURE_KEYS_KEPT` by when their key last changed. Writes only a change.
 */
export function recordFailureKeys(
  store: Store,
  worktreeId: WorktreeId,
  checks: ReadonlyMap<string, CheckKey | null>,
): void {
  if (checks.size === 0) return;
  const kept = new Map(readFailureKeys(store, worktreeId));
  let changed = false;
  for (const [id, key] of checks) {
    if (key === null) {
      changed = kept.delete(id) || changed;
      continue;
    }
    if (kept.get(id) === key) continue;
    kept.delete(id);
    kept.set(id, key);
    changed = true;
  }
  if (!changed) return;
  const newest = [...kept].slice(-FAILURE_KEYS_KEPT);
  store.meta.set(failureKeysMetaKey(worktreeId), JSON.stringify(Object.fromEntries(newest)));
}
