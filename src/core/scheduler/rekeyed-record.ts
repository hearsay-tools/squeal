import { isRecord } from "../fs/index.js";
import type { RevisionNumber, Store, WorktreeId } from "../types/index.js";

/*
 * Review wave 13u, B1 (task 001-238): the scheduler's record of the files
 * revisions' changes re-keyed (`FileState.keyedAt`, tasks 001-186 and
 * 001-194), kept in the store so a hook's delivery reads the set `status
 * --wait` reads instead of comparing keys (tasks 001-223 and 001-224). Per
 * test file: the earliest re-key revision with no result since (`open`,
 * `null` once a result or `unknown` landed at its key) and the latest re-key
 * revision ever recorded (`last`). A key moved back without a result keeps
 * its `open` revision, so the file is owed until it has one; a baseline's, a
 * backlog's or a run's key move is never recorded, so a first listing is no
 * edit until an edit moves its key.
 *
 * One JSON row per worktree, written in the scheduler's commit transaction
 * and read in the delivery's. One entry per test file, removed with the file;
 * a resolved entry no consumer's edits can still count is pruned by delivery
 * (`pruneRekeyed`).
 */

/** `meta` key of a worktree's re-key record. */
export function rekeyedMetaKey(worktreeId: WorktreeId): string {
  return `rekeyed.${worktreeId}`;
}

/** One test file's entry: its unresolved re-key revision and its latest. */
export interface RekeyedEntry {
  readonly open: RevisionNumber | null;
  readonly last: RevisionNumber;
}

/** What one commit learned of a file (`testFileId`): its `open` now, and the latest revision that re-keyed it, if any did. */
export interface RekeyedMark {
  readonly id: string;
  readonly open: RevisionNumber | null;
  readonly moved: RevisionNumber | null;
}

const isRevision = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value);

/** The worktree's record by `testFileId`; empty when missing or unreadable. */
export function readRekeyed(store: Store, worktreeId: WorktreeId): Map<string, RekeyedEntry> {
  const raw = store.meta.get(rekeyedMetaKey(worktreeId));
  const entries = new Map<string, RekeyedEntry>();
  let value: unknown = null;
  try {
    value = raw === null ? null : JSON.parse(raw);
  } catch {
    return entries;
  }
  if (!isRecord(value)) return entries;
  for (const [id, entry] of Object.entries(value)) {
    if (!Array.isArray(entry) || !isRevision(entry[1])) continue;
    entries.set(id, { open: isRevision(entry[0]) ? entry[0] : null, last: entry[1] });
  }
  return entries;
}

function write(store: Store, worktreeId: WorktreeId, entries: ReadonlyMap<string, RekeyedEntry>) {
  const key = rekeyedMetaKey(worktreeId);
  if (entries.size === 0) {
    if (store.meta.get(key) !== null) store.meta.delete(key);
    return;
  }
  const row = Object.fromEntries([...entries].map(([id, e]) => [id, [e.open, e.last]]));
  store.meta.set(key, JSON.stringify(row));
}

/**
 * Records `marks` and forgets `removed` (`testFileId`s). Call inside the
 * scheduler's commit transaction. A mark with no revision before or now is
 * nothing to record.
 */
export function recordRekeyed(
  store: Store,
  worktreeId: WorktreeId,
  marks: readonly RekeyedMark[],
  removed: readonly string[],
): void {
  if (marks.length === 0 && removed.length === 0) return;
  const entries = readRekeyed(store, worktreeId);
  let changed = false;
  for (const id of removed) changed = entries.delete(id) || changed;
  for (const { id, open, moved } of marks) {
    const previous = entries.get(id);
    const latest = [previous?.last, moved, open].filter(isRevision);
    if (latest.length === 0) continue;
    const next = { open, last: Math.max(...latest) };
    if (previous?.open === next.open && previous.last === next.last) continue;
    entries.set(id, next);
    changed = true;
  }
  if (changed) write(store, worktreeId, entries);
}

/**
 * Drops the resolved entries whose latest re-key is at or before `upTo`: no
 * consumer whose edits start after it can count them. Call inside a
 * transaction.
 */
export function pruneRekeyed(store: Store, worktreeId: WorktreeId, upTo: RevisionNumber): void {
  const entries = readRekeyed(store, worktreeId);
  const before = entries.size;
  for (const [id, entry] of entries) {
    if (entry.open === null && entry.last <= upTo) entries.delete(id);
  }
  if (entries.size !== before) write(store, worktreeId, entries);
}
