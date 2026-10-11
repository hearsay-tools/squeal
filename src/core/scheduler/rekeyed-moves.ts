import { isRecord } from "../fs/index.js";
import { testFileId } from "../keys/index.js";
import {
  type EpochMs,
  type RekeyedTestFile,
  type RevisionNumber,
  refinedMetaKey,
  type Store,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";
import type { RekeyedMark } from "./rekeyed-record.js";

/*
 * Task 001-258 (research/wait-from-store.md): the re-key moves `status
 * --wait` reads from the store, in its own read transaction, instead of a
 * sync answer the daemon held in memory. Per test file: its open move, the
 * earliest and the latest re-key revision with no result since, and each
 * resolved revision with the commit (`seq`) and the time it was resolved
 * at. A move back to a resolved revision opens it again (review wave 13k,
 * B1); a later move resolved first is kept beside the earlier one (13l S1).
 *
 * One JSON row per worktree, written in the scheduler's commit transaction
 * beside the `rekeyed` row (`rekeyedMetaKey`), which older hooks read and
 * this leaves alone. A wait reads `seq` with its start view; an entry
 * resolved at a later `seq` is the wait's news. A resolved entry is pruned
 * an hour after it resolved, and only once refinement has been caught up for
 * a minute, so no wait still refining its captured revision loses one (13q
 * S1, 13s B2, 13t S1): nothing is held per request, and nothing runs on a
 * timer. A wait whose start predates a pruned entry (`dropped`) falls back,
 * never ends quiet.
 */

/** `meta` key of a worktree's re-key moves. */
export function rekeyedMovesMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("rekeyedMoves", worktreeId);
}

/** How long a resolved move stays readable once refinement caught up. */
export const MOVES_RETENTION_MS = 60 * 60_000;
/**
 * How long refinement must have been caught up before a commit prunes:
 * longer than a wait's gap between two reads of a busy store.
 */
export const MOVES_GRACE_MS = 60_000;

interface FileMoves {
  /** The earliest and the latest re-key revision with no result since; `null` with none. */
  open: [RevisionNumber, RevisionNumber] | null;
  /** By revision: the commit and the time its move was resolved at. */
  resolved: Record<string, [number, EpochMs]>;
}

interface Moves {
  /** The commits that wrote the record. */
  seq: number;
  /** Since when the refined revision has been the current one; `null` while behind. */
  caughtUpAt: EpochMs | null;
  /** The latest `seq` of a resolved move a prune dropped. */
  dropped: number;
  /** By `testFileId`. */
  files: Record<string, FileMoves>;
}

const isInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value);

const asPair = (value: unknown): [number, number] | null =>
  Array.isArray(value) && isInt(value[0]) && isInt(value[1]) ? [value[0], value[1]] : null;

/** The worktree's moves; `null` when missing or unreadable. */
function readMoves(store: Store, worktreeId: WorktreeId): Moves | null {
  const raw = store.meta.get(rekeyedMovesMetaKey(worktreeId));
  let value: unknown = null;
  try {
    value = raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || !isInt(value.seq) || !isInt(value.dropped) || !isRecord(value.files)) {
    return null;
  }
  const files: Record<string, FileMoves> = {};
  for (const [id, entry] of Object.entries(value.files)) {
    if (!isRecord(entry) || !isRecord(entry.resolved)) continue;
    const resolved: Record<string, [number, EpochMs]> = {};
    for (const [revision, at] of Object.entries(entry.resolved)) {
      const pair = asPair(at);
      if (pair !== null) resolved[revision] = pair;
    }
    files[id] = { open: asPair(entry.open), resolved };
  }
  const caughtUpAt = isInt(value.caughtUpAt) ? value.caughtUpAt : null;
  return { seq: value.seq, caughtUpAt, dropped: value.dropped, files };
}

/** The record's commit sequence, which a wait reads with its start view; `null` with no record. */
export function movesSeq(store: Store, worktreeId: WorktreeId): number | null {
  return readMoves(store, worktreeId)?.seq ?? null;
}

/** The refined revision, `null` when none was recorded (a store before the runner part had one). */
function refinedRevision(store: Store, worktreeId: WorktreeId): RevisionNumber | null {
  const refined = Number(store.meta.get(refinedMetaKey(worktreeId)) ?? Number.NaN);
  return Number.isInteger(refined) ? refined : null;
}

/**
 * Records one commit's `marks` and forgets `removed` (`testFileId`s), at
 * `now`, while the worktree's revision is `revision`. Call inside the
 * scheduler's commit transaction, before it records its own refined
 * revision. Prunes resolved moves older than `MOVES_RETENTION_MS` once
 * refinement has been caught up for `MOVES_GRACE_MS`.
 */
export function recordMoves(
  store: Store,
  worktreeId: WorktreeId,
  marks: readonly RekeyedMark[],
  removed: readonly string[],
  revision: RevisionNumber,
  now: EpochMs,
): void {
  const read = readMoves(store, worktreeId);
  const moves = read ?? { seq: 0, caughtUpAt: null, dropped: 0, files: {} };
  const seq = moves.seq + 1;
  let changed = read === null;
  for (const id of removed) {
    if (id in moves.files) {
      delete moves.files[id];
      changed = true;
    }
  }
  for (const mark of marks) changed = apply(moves, mark, seq, now) || changed;
  const refined = refinedRevision(store, worktreeId);
  const caughtUpAt = refined === null || refined >= revision ? (moves.caughtUpAt ?? now) : null;
  if (caughtUpAt !== moves.caughtUpAt) {
    moves.caughtUpAt = caughtUpAt;
    changed = true;
  }
  if (caughtUpAt !== null && now - caughtUpAt >= MOVES_GRACE_MS) {
    changed = prune(moves, now - MOVES_RETENTION_MS) || changed;
  }
  if (!changed) return;
  moves.seq = seq;
  store.meta.set(rekeyedMovesMetaKey(worktreeId), JSON.stringify(moves));
}

/** One file's mark at commit `seq`; whether it changed the record. */
function apply(moves: Moves, { id, open, moved }: RekeyedMark, seq: number, at: EpochMs): boolean {
  const file = moves.files[id] ?? { open: null, resolved: {} };
  const before = JSON.stringify(file);
  if (open === null) {
    // A result, or `unknown`, at the file's key: its open moves are resolved now.
    for (const revision of new Set([...(file.open ?? []), ...(moved === null ? [] : [moved])])) {
      file.resolved[String(revision)] = [seq, at];
    }
    file.open = null;
  } else {
    // Owed from the earliest; a move back to a resolved revision is owed again.
    const revisions = [open, ...(moved === null ? [] : [moved])];
    file.open = [
      Math.min(file.open?.[0] ?? open, ...revisions),
      Math.max(file.open?.[1] ?? open, ...revisions),
    ];
    for (const revision of revisions) delete file.resolved[String(revision)];
  }
  if (file.open === null && Object.keys(file.resolved).length === 0) {
    const had = id in moves.files;
    delete moves.files[id];
    return had;
  }
  moves.files[id] = file;
  return JSON.stringify(file) !== before;
}

/** Drops resolved moves before `cutoff`; whether any went. */
function prune(moves: Moves, cutoff: EpochMs): boolean {
  let pruned = false;
  for (const [id, file] of Object.entries(moves.files)) {
    for (const [revision, [seq, at]] of Object.entries(file.resolved)) {
      if (at >= cutoff) continue;
      delete file.resolved[revision];
      moves.dropped = Math.max(moves.dropped, seq);
      pruned = true;
    }
    if (file.open === null && Object.keys(file.resolved).length === 0) delete moves.files[id];
  }
  return pruned;
}

/**
 * What a wait reads once the daemon captured `upTo`: `refining` until the
 * store's refined revision reached it; `incomplete` with no record, or when
 * a prune dropped a move resolved after the wait's start (`sinceSeq`), so
 * the wait falls back and never ends quiet; else every move at a revision
 * up to `upTo` that is open, or was resolved after the start (`resolved`).
 */
export type MovesAnswer =
  | { readonly state: "refining" }
  | { readonly state: "incomplete" }
  | { readonly state: "answered"; readonly rekeyed: readonly RekeyedTestFile[] };

/** The wait's answer, read in the caller's read transaction (`MovesAnswer`). */
export function answerMoves(
  store: Store,
  worktreeId: WorktreeId,
  upTo: RevisionNumber,
  sinceSeq: number,
): MovesAnswer {
  const refined = refinedRevision(store, worktreeId);
  if (refined !== null && refined < upTo) return { state: "refining" };
  const moves = readMoves(store, worktreeId);
  if (moves === null || moves.dropped > sinceSeq) return { state: "incomplete" };
  const refs = new Map(
    store.testFileKeys.list(worktreeId).map((row) => [testFileId(row.testFile), row.testFile]),
  );
  const rekeyed: RekeyedTestFile[] = [];
  for (const [id, file] of Object.entries(moves.files)) {
    const testFile = refs.get(id);
    if (testFile === undefined) continue;
    for (const revision of new Set(file.open ?? [])) {
      if (revision <= upTo) rekeyed.push({ testFile, revision });
    }
    for (const [raw, [seq]] of Object.entries(file.resolved)) {
      const revision = Number(raw);
      if (seq > sinceSeq && revision <= upTo) rekeyed.push({ testFile, revision, resolved: true });
    }
  }
  return { state: "answered", rekeyed };
}
