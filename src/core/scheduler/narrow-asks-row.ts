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
 * live daemon's start. Row 011-426 adds the lanes' commit asks and open
 * whole-group requests (`LaneRequestsMore`), published on each change too.
 */

/** One narrow ask: the file's `testFileId` and the key it was asked at. */
export type NarrowAskEntry = readonly [id: string, key: string];

function narrowAsksMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("narrowAsks", worktreeId);
}

/**
 * Row 011-426 (review 0.1.650 B1): the rest of a lane's request state, in
 * the same row so one read sees it at one moment. `commit`: the files a
 * commit asked a `commit` group's lane to run (`SlowTier.asks`), each at
 * its asked key. `requested`: the groups whose lane has an open request for
 * every file of it (`squeal run <group>`, `SlowTier.requested`), until the
 * lane has no file queued. Both absent when empty; a reader of an older row
 * reads none.
 */
export interface LaneRequestsMore {
  readonly commit?: readonly NarrowAskEntry[];
  readonly requested?: readonly string[];
}

/** Writes `worktreeId`'s narrow asks, and its lanes' other requests (`more`), as of `at`; none drops the row. */
export function publishNarrowAsks(
  store: Store,
  worktreeId: WorktreeId,
  asks: readonly NarrowAskEntry[],
  at: EpochMs,
  more: LaneRequestsMore = {},
): void {
  const key = narrowAsksMetaKey(worktreeId);
  const commit = more.commit ?? [];
  const requested = more.requested ?? [];
  if (asks.length + commit.length + requested.length === 0) {
    store.meta.delete(key);
    return;
  }
  const row = {
    at,
    asks,
    ...(commit.length === 0 ? {} : { commit }),
    ...(requested.length === 0 ? {} : { requested }),
  };
  store.meta.set(key, JSON.stringify(row));
}

/** What the live daemon's lanes were asked to run (`publishNarrowAsks`). */
export interface LaneRequests {
  /** Each narrow ask's asked key by `testFileId`. */
  readonly narrow: ReadonlyMap<string, string>;
  /** Each commit ask's asked key by `testFileId`. */
  readonly commit: ReadonlyMap<string, string>;
  /** The groups with an open request for every file of them. */
  readonly requested: ReadonlySet<string>;
}

const NO_REQUESTS: LaneRequests = { narrow: new Map(), commit: new Map(), requested: new Set() };

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
  return publishedLaneRequests(store, worktreeId, daemonStartedAt).narrow;
}

/** Every request `publishNarrowAsks` wrote, by the same rule; none from a row an earlier daemon wrote. */
export function publishedLaneRequests(
  store: Store,
  worktreeId: WorktreeId,
  daemonStartedAt: EpochMs,
): LaneRequests {
  const raw = store.meta.get(narrowAsksMetaKey(worktreeId));
  if (raw === null) return NO_REQUESTS;
  try {
    const row = JSON.parse(raw) as {
      at?: unknown;
      asks?: unknown;
      commit?: unknown;
      requested?: unknown;
    };
    if (typeof row.at !== "number" || row.at < daemonStartedAt || !Array.isArray(row.asks)) {
      return NO_REQUESTS;
    }
    const names = Array.isArray(row.requested) ? row.requested : [];
    return {
      narrow: entriesOf(row.asks),
      commit: entriesOf(row.commit),
      requested: new Set(names.filter((name): name is string => typeof name === "string")),
    };
  } catch {
    return NO_REQUESTS;
  }
}

function entriesOf(value: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(value)) return out;
  for (const entry of value) {
    if (!Array.isArray(entry)) continue;
    const [id, key] = entry as unknown[];
    if (typeof id === "string" && typeof key === "string") out.set(id, key);
  }
  return out;
}
