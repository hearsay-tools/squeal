import { type KeysReadAsOne, testFileId } from "../keys/index.js";
import { heldFailure } from "../state/index.js";
import type {
  CheckId,
  CheckKey,
  EpochMs,
  ResultRecord,
  Store,
  WorktreeId,
} from "../types/index.js";
import { checkId } from "./files.js";

/*
 * The accept rule (spec 011 C3 and C4 step 3, task 011-37 section 5): which
 * stored results may stand for a test file in this worktree, and which of
 * its checks they retire. `Ledger` keeps the file states, the queue and the
 * writes owed; this is the part of a lookup a stored row's meaning rests on,
 * so the key format alarm reads it apart from them (row 011-40).
 */

/**
 * The formats C3 reads as one, for a miss (task 011-38): the key's file and
 * its keys at each listed format, and what each file was last read at in
 * this daemon (`testFileId`): its key and those keys (`readAt`), so each file
 * is read once per key and keys read as one. A closure change can move those
 * keys alone: a path with no file leaving it moves the key before 011-158,
 * not the current one (review 0.1.285 B1).
 */
export interface ReadAsOne {
  readonly keys: (key: CheckKey) => KeysReadAsOne | null;
  readonly read: Map<string, string>;
}

/**
 * The stored results of `key` that may stand for its file in `worktreeId`,
 * and whether a miss may wait on another worktree's claim of `key` (task
 * 001-205). Every hit stands, unless one is another worktree's fail this
 * worktree has not confirmed (spec 001 D6 as amended, task 001-170,
 * `heldFailure`): then none does, the file is a miss and runs here, and its
 * local result replaces the shared row. The store holds one result per check
 * and key, so a mixed set is never partly this worktree's own. A miss may
 * wait only when no result is stored, so none was withheld. A slow file
 * inherits as any file (004 D6 as amended 2026-10-18, task 004-81). A miss
 * first copies a set stored at a format read as one (`copyReadAsOne`).
 */
export function acceptedAt(
  store: Store,
  worktreeId: WorktreeId,
  key: CheckKey,
  now: () => EpochMs,
  listed: ReadAsOne,
): { hits: readonly ResultRecord[]; mayWait: boolean } {
  let hits = store.results.byKey(key, now());
  if (hits.length === 0 && copyReadAsOne(store, key, listed))
    hits = store.results.byKey(key, now());
  if (hits.length === 0) return { hits, mayWait: true };
  if (hits.every((hit) => hit.provenance.worktreeId === worktreeId)) {
    return { hits, mayWait: false };
  }
  const held = heldFailure(store, worktreeId, hits) !== undefined;
  return { hits: held ? [] : hits, mayWait: false };
}

/**
 * Spec 011 C4 step 3 as amended 2026-10-20 (task 011-38): "A key with no
 * result is first read at the formats C3 reads as one, once per file and
 * key in a daemon", once per file, key and keys read as one since row
 * 011-158. The newest set stored at one is copied to `key`
 * (`ResultRepo.copyNewest`, C7) in a statement of its own, so the write
 * lock is held for one copy at a time, and only while no row is stored at
 * `key`. True when it copied a set. A busy store's error leaves the read to
 * the next lookup.
 */
function copyReadAsOne(store: Store, key: CheckKey, listed: ReadAsOne): boolean {
  const found = listed.keys(key);
  if (found === null || found.keys.length === 0) return false;
  const id = testFileId(found.testFile);
  const at = readAt(key, found.keys);
  if (listed.read.get(id) === at) return false;
  const copied = store.results.copyNewest(key, found.keys);
  listed.read.set(id, at);
  return copied;
}

/** What a file is read at: its key and its keys read as one, in their order. */
function readAt(key: CheckKey, keys: readonly CheckKey[]): string {
  return [key, ...keys].join(" ");
}

/**
 * Spec 001 D8: the checks of `results`, which become a file's current
 * results, and those of `previous`, its current ones until now, that they
 * lack: "Checks that disappear from a test file are retired".
 */
export function currentChecks(
  previous: readonly CheckId[],
  results: readonly ResultRecord[],
): { checks: CheckId[]; retired: CheckId[] } {
  const checks = results.map((r) => r.check);
  const kept = new Set(checks.map(checkId));
  return { checks, retired: previous.filter((check) => !kept.has(checkId(check))) };
}
