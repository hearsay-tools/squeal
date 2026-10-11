import { isRecord } from "../fs/index.js";
import { testFileId } from "../keys/index.js";
import {
  daemonIncarnation,
  type EpochMs,
  type RekeyedTestFile,
  type RevisionNumber,
  refinedMetaKey,
  type Store,
  type TestFileKeyRecord,
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
 *
 * Review waves 13ac and 13ad, B1 (tasks 001-265, 001-268): a daemon
 * before 001-258 moves keys and refines without writing this record, and
 * may run before or after a newer one, even between two of a wait's reads;
 * a key it moves away and back leaves no trace in the rows. So the record
 * names the daemon incarnation that wrote it (`writer`), and a wait trusts
 * it only while the worktree's registered daemon is that incarnation, the
 * one that answered its sync (`movesTrusted`). Every daemon registers
 * before it writes a row, so another writer's rows come with another
 * registration. A ledger's first commit takes in every pending row as a
 * move open at its row's revision, whoever wrote it, and the history before
 * as lost (`dropped`), so a wait that started before falls back; unless the
 * daemon registered before it wrote the record last, or none ever was
 * (`adoptsAtFirstCommit`).
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
  /**
   * The latest `seq` of a resolved move a prune dropped, or of a ledger's
   * first commit, which took in what writers before it left pending.
   */
  dropped: number;
  /** By `testFileId`. */
  files: Record<string, FileMoves>;
  /**
   * The incarnation of the daemon whose ledger last wrote the record
   * (`daemonIncarnation`); `null` when unknown: a record before task
   * 001-268, or a writer that named none, which no wait trusts.
   */
  writer: string | null;
}

/** Who writes one commit's moves (`recordMoves`). */
export interface MovesWriter {
  /** The writing daemon's incarnation; `null` when it has none. */
  readonly writer: string | null;
  /** At a ledger's first commit: the worktree's rows before it wrote any. */
  readonly before?: readonly TestFileKeyRecord[];
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
  return {
    seq: value.seq,
    caughtUpAt,
    dropped: value.dropped,
    files,
    writer: typeof value.writer === "string" ? value.writer : null,
  };
}

/**
 * Whether a wait that started at `sinceSeq`, whose sync `incarnation`
 * answered, may trust the record: one exists, no prune or ledger's first
 * commit lost a move since, that incarnation wrote it last and is still the
 * worktree's registered daemon (review waves 13ac and 13ad, B1). Read in
 * the wait's read transaction, beside what it decides with.
 */
export function movesTrusted(
  store: Store,
  worktreeId: WorktreeId,
  sinceSeq: number,
  incarnation: string | null,
): boolean {
  return trusted(store, worktreeId, readMoves(store, worktreeId), sinceSeq, incarnation);
}

function trusted(
  store: Store,
  worktreeId: WorktreeId,
  moves: Moves | null,
  sinceSeq: number,
  incarnation: string | null,
): boolean {
  return (
    incarnation !== null &&
    moves !== null &&
    moves.dropped <= sinceSeq &&
    moves.writer === incarnation &&
    daemonIncarnation(store.worktrees.get(worktreeId)?.daemon ?? null) === incarnation
  );
}

/**
 * Whether a ledger's first commit takes in what the writers before it left
 * (`MovesWriter.before`), given the incarnation of the daemon registered on
 * the worktree before its own (`predecessorIncarnation`). Every daemon of
 * every release registers before it writes a row, and two never run one
 * worktree at once, so that registration names the last daemon that could
 * have written one. When it also wrote the record last, the record holds
 * every move of its rows (a restart from one daemon of task 001-268 to
 * another), and when there was none (a fresh worktree) there are no rows:
 * neither takes anything in. A predecessor that cannot be read
 * (`undefined`), or any other, does (decided by the human, 2026-10-11).
 */
export function adoptsAtFirstCommit(
  store: Store,
  worktreeId: WorktreeId,
  predecessor: string | null | undefined,
): boolean {
  if (predecessor === null) return false;
  return predecessor === undefined || readMoves(store, worktreeId)?.writer !== predecessor;
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
 * refinement has been caught up for `MOVES_GRACE_MS`. Names `by.writer`
 * as the record's writer. At a ledger's first commit (`by.before`), takes
 * in each pending row as a move open at its revision, whatever wrote it,
 * and the history before this commit as lost (`dropped`).
 */
export function recordMoves(
  store: Store,
  worktreeId: WorktreeId,
  marks: readonly RekeyedMark[],
  removed: readonly string[],
  revision: RevisionNumber,
  now: EpochMs,
  by: MovesWriter,
): void {
  const read = readMoves(store, worktreeId);
  const moves = read ?? { seq: 0, caughtUpAt: null, dropped: 0, files: {}, writer: null };
  const seq = moves.seq + 1;
  let changed = read === null || moves.writer !== by.writer;
  moves.writer = by.writer;
  if (by.before !== undefined) {
    // Review wave 13ad, B1: a row's values do not say who moved it, nor how often.
    moves.dropped = seq;
    changed = true;
    for (const row of by.before) {
      if (row.pending === null) continue;
      const id = testFileId(row.testFile);
      apply(moves, { id, open: row.revision, moved: row.revision }, seq, now);
    }
  }
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
 * store's refined revision reached it; `incomplete` when the wait may not
 * trust the record (`movesTrusted`): none, a move lost since the wait's
 * start (`sinceSeq`), or another incarnation than the sync's wrote it or is
 * registered, so the wait falls back and never ends quiet; else every move
 * at a revision up to `upTo` that is open, or was resolved after the start
 * (`resolved`).
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
  incarnation: string | null,
): MovesAnswer {
  const moves = readMoves(store, worktreeId);
  if (moves === null || !trusted(store, worktreeId, moves, sinceSeq, incarnation)) {
    return { state: "incomplete" };
  }
  const refined = refinedRevision(store, worktreeId);
  if (refined !== null && refined < upTo) return { state: "refining" };
  const rows = store.testFileKeys.list(worktreeId);
  const refs = new Map(rows.map((row) => [testFileId(row.testFile), row.testFile]));
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
