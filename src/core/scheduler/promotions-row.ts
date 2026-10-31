import {
  type BatchPlace,
  type EpochMs,
  type Store,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";

/**
 * A live batch as `meta` holds it for status (task 011-13): the files its
 * wait selected, by `testFileId`, and its wait's deadline, as a reader
 * before row 011-268 reads them, a promotion until `until`. `batch` marks
 * a row of a daemon from row 011-268 on: the batch's own files, which live
 * past `until` until they settle, and the estimated end of its tier.
 */
export interface PublishedPromotion {
  readonly files: readonly string[];
  readonly until: EpochMs;
  readonly batch?: { readonly files: readonly string[]; readonly estimatedEnd: EpochMs | null };
}

/*
 * Task 011-13 (011 C15, "queued, promoted, behind ..."): the daemon
 * publishes its live promotions in one `meta` row per worktree, rewritten on
 * each change and dropped when none is left, for the named wait's reasons to
 * read in their own transaction. The row carries when it was written: a
 * reader takes none older than the live daemon's start. Row 011-283: the
 * store holds the batches, so a successor reads its predecessor's row once,
 * at its baseline (`inheritedBatches`), takes over what it queued again at
 * the same key and republishes it. A deadline is on the daemon's clock, the
 * host's, as every time in the store is.
 */

/** `meta` key of `worktreeId`'s live promotions: `{ at, promotions }`. */
export function promotionsMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("promotions", worktreeId);
}

/** Writes `worktreeId`'s live promotions as of `at`; none drops the row. */
export function publishPromotions(
  store: Store,
  worktreeId: WorktreeId,
  live: readonly PublishedPromotion[],
  at: EpochMs,
): void {
  const key = promotionsMetaKey(worktreeId);
  if (live.length === 0) store.meta.delete(key);
  else store.meta.set(key, JSON.stringify({ at, promotions: live }));
}

/**
 * The `testFileId`s a promotion of the daemon started at `daemonStartedAt`
 * holds at `now`; empty with no row, as from a daemon older than 011-13, or
 * with a predecessor's.
 */
export function promotedIds(
  store: Store,
  worktreeId: WorktreeId,
  daemonStartedAt: EpochMs,
  now: EpochMs,
): ReadonlySet<string> {
  return new Set(publishedBatches(store, worktreeId, daemonStartedAt, now).keys());
}

/**
 * Each file `promotedIds` holds, with its batch's place (row 011-268): its
 * position among the live batches, their count, its files and its tier's
 * estimated end. A batch lives past its wait's deadline; an entry of a
 * daemon older than row 011-268 lives until its deadline and has no place
 * (`null`).
 */
export function publishedBatches(
  store: Store,
  worktreeId: WorktreeId,
  daemonStartedAt: EpochMs,
  now: EpochMs,
): ReadonlyMap<string, BatchPlace | null> {
  const places = new Map<string, BatchPlace | null>();
  const row = readRow(store, worktreeId);
  if (row === null || row.at < daemonStartedAt) return places;
  const batches = row.entries.filter(isBatch);
  for (const p of row.entries) {
    const position = batches.indexOf(p) + 1;
    if (position === 0 && (p.batch !== undefined || p.until <= now)) continue;
    const files = strings(position === 0 ? p.files : p.batch?.files);
    const end = p.batch?.estimatedEnd;
    const place: BatchPlace | null =
      position === 0
        ? null
        : {
            position,
            of: batches.length,
            files: files.length,
            estimatedEnd: typeof end === "number" ? (end as EpochMs) : null,
          };
    for (const f of files) if (!places.has(f)) places.set(f, place);
  }
  return places;
}

/**
 * Row 011-283: the batches of `worktreeId`'s row, whoever wrote it and
 * however old, in their order: each one's own files, by `testFileId`, and
 * its wait's deadline. A row of a daemon older than row 011-268 has none.
 */
export function inheritedBatches(
  store: Store,
  worktreeId: WorktreeId,
): { readonly files: readonly string[]; readonly until: number }[] {
  const row = readRow(store, worktreeId);
  if (row === null) return [];
  return row.entries
    .filter(isBatch)
    .map((p) => ({ files: strings(p.batch?.files), until: p.until }));
}

/** `worktreeId`'s row, its entries well formed; `null` with none or one that does not parse. */
function readRow(
  store: Store,
  worktreeId: WorktreeId,
): { readonly at: number; readonly entries: readonly PublishedPromotion[] } | null {
  const raw = store.meta.get(promotionsMetaKey(worktreeId));
  if (raw === null) return null;
  try {
    const { at, promotions } = JSON.parse(raw) as { at?: unknown; promotions?: unknown };
    if (typeof at !== "number" || !Array.isArray(promotions)) return null;
    const entries = promotions.filter(
      (p): p is PublishedPromotion =>
        typeof p === "object" &&
        p !== null &&
        typeof p.until === "number" &&
        Array.isArray(p.files),
    );
    return { at, entries };
  } catch {
    return null;
  }
}

/** A wait with no file of its own is no batch (`Promotions.add`). */
function isBatch(p: PublishedPromotion): boolean {
  return typeof p.batch === "object" && p.batch !== null && (p.batch.files?.length ?? 0) > 0;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((f): f is string => typeof f === "string") : [];
}
