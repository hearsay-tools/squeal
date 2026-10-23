import { testFileId } from "../keys/index.js";
import type {
  CheckKey,
  DaemonLiveness,
  EpochMs,
  RunRecord,
  Store,
  TestFileRef,
  WorktreeId,
  WorktreeRecord,
} from "../types/index.js";
import { HEARTBEAT_GRACE_INTERVALS } from "./snapshot.js";

/**
 * When the worktree's live daemon started: the rows it publishes are trusted
 * from then on (C15); `null` without a live one.
 */
export function liveStartedAt(
  worktree: WorktreeRecord | null,
  daemon: DaemonLiveness,
): EpochMs | null {
  const record = worktree?.daemon ?? null;
  return record === null || daemon.state !== "alive" ? null : record.startedAt;
}

/**
 * The runs the worktree's live daemon has open, oldest first: those with no
 * end that it started (task 011-12). A run an earlier daemon left open, or
 * one of a daemon that is down, runs nothing now.
 */
export function openRuns(
  store: Store,
  worktree: WorktreeRecord | null,
  daemon: DaemonLiveness,
): readonly RunRecord[] {
  const startedAt = liveStartedAt(worktree, daemon);
  if (worktree === null || startedAt === null) return [];
  return store.runs.inFlight(worktree.id, startedAt);
}

/** The open runs of `worktreeId`'s live daemon, read from its row. */
export function openRunsOf(
  store: Store,
  worktreeId: WorktreeId,
  daemon: DaemonLiveness,
): readonly RunRecord[] {
  return openRuns(store, store.worktrees.get(worktreeId), daemon);
}

/**
 * The other worktree whose live daemon runs `key` now (C7's claim:
 * `TestFileKeyRepo.claimed`), with the run that holds `ref` when it has one
 * open; `null` when none does (task 011-12).
 */
export function claimantOf(
  store: Store,
  worktreeId: WorktreeId,
  ref: TestFileRef,
  key: CheckKey,
  now: EpochMs,
): { readonly worktree: WorktreeRecord; readonly run: RunRecord | null } | null {
  if (
    !store.testFileKeys.claimed(worktreeId, key, { now, graceIntervals: HEARTBEAT_GRACE_INTERVALS })
  ) {
    return null;
  }
  const id = testFileId(ref);
  for (const worktree of store.worktrees.list()) {
    if (worktree.id === worktreeId || worktree.daemon === null) continue;
    // The claim's own liveness, as `claimed` reads it: a dead row's stale `running` names no claimant (review wave-1.11 B2).
    const { heartbeatAt, heartbeatIntervalMs } = worktree.daemon;
    if (heartbeatAt < now - HEARTBEAT_GRACE_INTERVALS * heartbeatIntervalMs) continue;
    const row = store.testFileKeys.list(worktree.id, [ref])[0];
    if (row?.key !== key || row.pending !== "running") continue;
    const runs = store.runs.inFlight(worktree.id, worktree.daemon.startedAt);
    const run = runs.find((r) => r.testFiles.some((f) => testFileId(f) === id)) ?? null;
    return { worktree, run };
  }
  return null;
}
