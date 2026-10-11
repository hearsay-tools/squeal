import { createHash } from "node:crypto";
import { isRecord } from "../fs/index.js";
import { testFileId } from "../keys/index.js";
import {
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
 * Review wave 13ac, B1 (task 001-265): a daemon before 001-258 moves keys
 * and refines without writing this record, and may succeed a newer one at
 * any time, before a wait's refinement or after its window. So the record
 * also keeps, per test file, the revision and key its writer last wrote
 * (`keys`), and vouches for the moves only while every `test_file_keys` row
 * still has them (`vouches`): a row another writer wrote makes a wait fall
 * back, in the same read it would trust the record in. A ledger's first
 * commit takes such rows in (`unrecordedRows`): a pending one as a move
 * open at its row's revision, and every one as lost history (`dropped`), so
 * a wait that started before falls back too.
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
   * The latest `seq` of a resolved move a prune dropped, or of a commit that
   * took in rows another writer wrote (`unrecordedRows`).
   */
  dropped: number;
  /** By `testFileId`. */
  files: Record<string, FileMoves>;
  /**
   * By `testFileId`: the revision and the key digest (`keyMark`) of the
   * file's `test_file_keys` row as this record's writer last wrote it;
   * `null` in a record before task 001-265, which vouches for no row.
   */
  keys: Record<string, KeyMark> | null;
}

/** A row's revision and its key's digest, `null` for an unkeyed file. */
type KeyMark = [RevisionNumber, string | null];

/** The rows one commit writes, and those its ledger found no record vouches for (`recordMoves`). */
export interface MovesRows {
  readonly written: readonly TestFileKeyRecord[];
  readonly unrecorded: readonly TestFileKeyRecord[];
}

const NO_ROWS: MovesRows = { written: [], unrecorded: [] };

function keyMark(row: TestFileKeyRecord): KeyMark {
  const key = row.key === null ? null : createHash("sha256").update(row.key).digest("base64url");
  return [row.revision, key === null ? null : key.slice(0, 16)];
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
  return { seq: value.seq, caughtUpAt, dropped: value.dropped, files, keys: readKeys(value.keys) };
}

function readKeys(value: unknown): Record<string, KeyMark> | null {
  if (!isRecord(value)) return null;
  const keys: Record<string, KeyMark> = {};
  for (const [id, mark] of Object.entries(value)) {
    if (!Array.isArray(mark) || !isInt(mark[0])) continue;
    keys[id] = [mark[0], typeof mark[1] === "string" ? mark[1] : null];
  }
  return keys;
}

/** Whether `moves` names every row as its writer last wrote it. */
function vouches(moves: Moves, rows: readonly TestFileKeyRecord[]): boolean {
  const { keys } = moves;
  if (keys === null) return false;
  return rows.every((row) => {
    const mark = keys[testFileId(row.testFile)];
    const [revision, key] = keyMark(row);
    return mark !== undefined && mark[0] === revision && mark[1] === key;
  });
}

/**
 * The worktree's `test_file_keys` rows the record does not name as its
 * writer last wrote them: another writer's, a daemon's before task 001-258
 * or 001-265. A ledger reads them before its first commit writes a row.
 */
export function unrecordedRows(store: Store, worktreeId: WorktreeId): readonly TestFileKeyRecord[] {
  const moves = readMoves(store, worktreeId);
  const rows = store.testFileKeys.list(worktreeId);
  return moves === null ? rows : rows.filter((row) => !vouches(moves, [row]));
}

/**
 * Whether a wait that started at `sinceSeq` may trust the record over the
 * worktree's `rows` (`test_file_keys`): one exists, no prune or other writer
 * lost a move since, and its writer wrote every row (review wave 13ac, B1).
 */
export function movesVouch(
  store: Store,
  worktreeId: WorktreeId,
  sinceSeq: number,
  rows: readonly TestFileKeyRecord[],
): boolean {
  const moves = readMoves(store, worktreeId);
  return moves !== null && moves.dropped <= sinceSeq && vouches(moves, rows);
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
 * refinement has been caught up for `MOVES_GRACE_MS`. Keeps the `rows` the
 * commit wrote as the record's own, and takes in the `unrecorded` ones: a
 * pending row as a move open at its revision, and the history before this
 * commit as lost (`dropped`).
 */
export function recordMoves(
  store: Store,
  worktreeId: WorktreeId,
  marks: readonly RekeyedMark[],
  removed: readonly string[],
  revision: RevisionNumber,
  now: EpochMs,
  rows: MovesRows = NO_ROWS,
): void {
  const read = readMoves(store, worktreeId);
  const moves = read ?? { seq: 0, caughtUpAt: null, dropped: 0, files: {}, keys: {} };
  const seq = moves.seq + 1;
  let changed = read === null || moves.keys === null;
  const keys = moves.keys ?? {};
  moves.keys = keys;
  for (const id of removed) {
    if (id in moves.files || id in keys) {
      delete moves.files[id];
      delete keys[id];
      changed = true;
    }
  }
  const gone = new Set(removed);
  const unrecorded = rows.unrecorded.filter((row) => !gone.has(testFileId(row.testFile)));
  if (unrecorded.length > 0) {
    moves.dropped = seq;
    changed = true;
  }
  for (const row of unrecorded) {
    if (row.pending === null) continue;
    const id = testFileId(row.testFile);
    apply(moves, { id, open: row.revision, moved: row.revision }, seq, now);
  }
  for (const mark of marks) changed = apply(moves, mark, seq, now) || changed;
  for (const row of [...unrecorded, ...rows.written]) {
    const id = testFileId(row.testFile);
    const mark = keyMark(row);
    if (keys[id]?.[0] === mark[0] && keys[id]?.[1] === mark[1]) continue;
    keys[id] = mark;
    changed = true;
  }
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
 * store's refined revision reached it; `incomplete` with no record, when
 * a prune dropped a move resolved after the wait's start (`sinceSeq`) or a
 * ledger took in another writer's rows since, or when a row is not as the
 * record's writer wrote it (`movesVouch`), so the wait falls back and never
 * ends quiet; else every move at a revision
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
  const rows = store.testFileKeys.list(worktreeId);
  if (moves === null || moves.dropped > sinceSeq || !vouches(moves, rows)) {
    return { state: "incomplete" };
  }
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
