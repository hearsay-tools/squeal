import type { EpochMs, WorktreeId } from "../types/common.js";
import { type Store, worktreeMetaKey } from "../types/store.js";

/*
 * Review 0.1.610 B1 (row 023-67): the files a narrow run asked a group's
 * lane to run (`squeal run <group> <path>...`, and `squeal status --at <c>
 * --run` on the working tree's side), each by `testFileId` with the key it
 * was asked at (`SlowTier.narrow`). Such a file runs whatever its group's
 * moment. A named wait's batch only orders the queue, so its membership is
 * no evidence that a held group's file runs; this row is. The scheduler
 * rewrites it when an ask comes or leaves and drops it when none is left.
 * The row carries when it was written: a reader takes none older than the
 * live daemon's start.
 */

/** One narrow ask: the file's `testFileId` and the key it was asked at. */
export type NarrowAskEntry = readonly [id: string, key: string];

function narrowAsksMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("narrowAsks", worktreeId);
}

/** Writes `worktreeId`'s narrow asks as of `at`; none drops the row. */
export function publishNarrowAsks(
  store: Store,
  worktreeId: WorktreeId,
  asks: readonly NarrowAskEntry[],
  at: EpochMs,
): void {
  const key = narrowAsksMetaKey(worktreeId);
  if (asks.length === 0) store.meta.delete(key);
  else store.meta.set(key, JSON.stringify({ at, asks }));
}

/**
 * The narrow asks the daemon started at `daemonStartedAt` published: each
 * file's asked key by `testFileId`. Empty with no row, with a row an
 * earlier daemon wrote, or with one that does not parse.
 */
export function publishedNarrowAsks(
  store: Store,
  worktreeId: WorktreeId,
  daemonStartedAt: EpochMs,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  const raw = store.meta.get(narrowAsksMetaKey(worktreeId));
  if (raw === null) return out;
  try {
    const { at, asks } = JSON.parse(raw) as { at?: unknown; asks?: unknown };
    if (typeof at !== "number" || at < daemonStartedAt || !Array.isArray(asks)) return out;
    for (const entry of asks) {
      if (!Array.isArray(entry)) continue;
      const [id, key] = entry as unknown[];
      if (typeof id === "string" && typeof key === "string") out.set(id, key);
    }
  } catch {
    return out;
  }
  return out;
}
