import { isRecord } from "../fs/index.js";
import { type Store, type WorktreeId, worktreeMetaKey } from "../types/index.js";

/*
 * Spec 004 D9 as amended 2026-10-12 (task 001-285): which harnesses ran the
 * waiting Stop entry (`stop-slow`) in a worktree, and at which Squeal
 * version. A main agent's 2 s Stop leaves slow files to that entry only once
 * it is known to run there: Codex runs a new plugin hook only after the user
 * trusts it, and an untrusted or missing waiting entry must leave
 * `stop.requireSlowSuite` holding as it did before, never holding nothing.
 * One JSON row per worktree, `{ "<harness>": "<version>" }`.
 */

/** The harnesses with a waiting Stop entry. */
export type StopWaitHarness = "claude-code" | "codex";

/** `meta` key of a worktree's waiting-entry record. */
export function stopWaitMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("stopWait", worktreeId);
}

function read(store: Store, worktreeId: WorktreeId): Record<string, unknown> {
  const raw = store.meta.get(stopWaitMetaKey(worktreeId));
  if (raw === null) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

/** Whether `harness`'s waiting entry ran in `worktreeId` at `version`. */
export function stopWaitRuns(
  store: Store,
  worktreeId: WorktreeId,
  harness: StopWaitHarness,
  version: string,
): boolean {
  return read(store, worktreeId)[harness] === version;
}

/** Records that `harness`'s waiting entry runs in `worktreeId` at `version`; writes only a change. */
export function recordStopWait(
  store: Store,
  worktreeId: WorktreeId,
  harness: StopWaitHarness,
  version: string,
): void {
  store.transaction(() => {
    const all = read(store, worktreeId);
    if (all[harness] === version) return;
    store.meta.set(stopWaitMetaKey(worktreeId), JSON.stringify({ ...all, [harness]: version }));
  });
}
