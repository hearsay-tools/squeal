import type { CheckKey, SlowTierActivity, Store, WorktreeId } from "../types/index.js";

/*
 * Spec 004 D8: what the slow tier of a worktree is doing, published by its
 * daemon (`SlowTier`) and read by headers and status, which need no daemon.
 * Only meaningful while a slow file is pending: readers take the store's
 * pending counts as the truth and this as the reason.
 *
 * And the artifact each slow run was declared to test (D5, D8, review wave 2
 * B2): the declared input globs of the policy the run had, by the key its
 * results are stored under, so a result names its own run's declaration and
 * never the policy on disk today.
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

/** `meta` key of a worktree's slow runs' declared artifacts, by key. */
export function slowArtifactsMetaKey(worktreeId: WorktreeId): string {
  return `slow-artifacts:${worktreeId}`;
}

/** The newest keys whose declared artifact a worktree keeps; an older one reads as unknown. */
export const SLOW_ARTIFACTS_KEPT = 256;

/**
 * The declared artifact globs of `worktreeId`'s slow runs by key: a key is
 * present when the newest run of it in that worktree was a slow one. Oldest
 * first. Empty when none is recorded or the row does not parse.
 */
export function readSlowArtifacts(
  store: Store,
  worktreeId: WorktreeId,
): ReadonlyMap<CheckKey, readonly string[]> {
  const raw = store.meta.get(slowArtifactsMetaKey(worktreeId));
  if (raw === null) return new Map();
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return new Map();
    return new Map(
      Object.entries(value).filter(
        (entry): entry is [CheckKey, string[]] =>
          Array.isArray(entry[1]) && entry[1].every((glob) => typeof glob === "string"),
      ),
    );
  } catch {
    return new Map();
  }
}

/**
 * Records that slow runs of `runs`' keys were declared to test their globs,
 * replacing a key's earlier record, and keeps the newest `SLOW_ARTIFACTS_KEPT`.
 * In the transaction that stores the runs' results.
 */
export function recordSlowArtifacts(
  store: Store,
  worktreeId: WorktreeId,
  runs: ReadonlyMap<CheckKey, readonly string[]>,
): void {
  if (runs.size === 0) return;
  const kept = new Map(readSlowArtifacts(store, worktreeId));
  for (const [key, globs] of runs) {
    kept.delete(key);
    kept.set(key, globs);
  }
  const newest = [...kept].slice(-SLOW_ARTIFACTS_KEPT);
  store.meta.set(slowArtifactsMetaKey(worktreeId), JSON.stringify(Object.fromEntries(newest)));
}

/** A fast run of `keys`: their results are no slow run's any more. Writes only a change. */
export function forgetSlowArtifacts(
  store: Store,
  worktreeId: WorktreeId,
  keys: Iterable<CheckKey>,
): void {
  const kept = new Map(readSlowArtifacts(store, worktreeId));
  let changed = false;
  for (const key of keys) changed = kept.delete(key) || changed;
  if (!changed) return;
  store.meta.set(slowArtifactsMetaKey(worktreeId), JSON.stringify(Object.fromEntries(kept)));
}
