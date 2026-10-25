import { testFileId } from "../keys/index.js";
import type { CheckKey, EpochMs, Store, TestFileRef } from "../types/index.js";
import type { RetryRecord } from "./records.js";

/*
 * Review 0.1.322 B2 (011 C15's 011-207 amendment): a named wait asks no
 * second run at a key where a request was ever stored, and the `retries` row
 * keeps only `RETRIES_KEPT` requests. So the fact is kept apart, in its own
 * `meta` row (011 C7: no new column under an unchanged `user_version`),
 * written in the transaction that stores the request. An entry stays while a
 * worktree's row holds its file at its key, or for 7 days after its last
 * ask, as D8 keeps results; past `ASKED_KEYS_KEPT` entries the lapsed go
 * first, then the oldest. The `retries` row drops its ended requests first
 * and never a pending one at a held key.
 */

/** `meta` key of the files and keys a request was stored at. */
export const ASKED_KEYS_META_KEY = "retries-asked";

/** The most entries kept: past it, lapsed entries go first, then the oldest. */
export const ASKED_KEYS_KEPT = 4_096;

/** How long an entry stays once no worktree's row holds its key (D8's retention). */
const ASKED_KEY_MS = 7 * 24 * 60 * 60 * 1_000;

/** A file and key a request was stored at, and when the last one was. */
export interface AskedKey extends TestFileRef {
  readonly key: CheckKey;
  readonly askedAt: EpochMs;
}

/** Whether any worktree's row holds a file at a key. */
export type Held = (testFile: TestFileRef, key: CheckKey) => boolean;

/** Every kept entry, oldest first; empty when the row is absent or does not parse. */
export function readAskedKeys(store: Store): AskedKey[] {
  const raw = store.meta.get(ASKED_KEYS_META_KEY);
  if (raw === null) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.flatMap(toAskedKey) : [];
  } catch {
    return [];
  }
}

/** Whether `entries` keep a request stored for `testFile` at `key`. */
export function isAsked(entries: readonly AskedKey[], testFile: TestFileRef, key: CheckKey) {
  const id = testFileId(testFile);
  return entries.some((e) => e.key === key && testFileId(e) === id);
}

/** Keeps `record`'s file and key as asked, in the caller's transaction, and drops what aged out. */
export function addAskedKey(store: Store, record: RetryRecord): void {
  const id = testFileId(record.testFile);
  const others = readAskedKeys(store).filter((e) => e.key !== record.key || testFileId(e) !== id);
  const entry = { ...record.testFile, key: record.key, askedAt: record.askedAt };
  const kept = keptAskedKeys([...others, entry], heldIn(store), record.askedAt);
  store.meta.set(
    ASKED_KEYS_META_KEY,
    JSON.stringify(kept.map((e) => [e.project, e.path, e.key, e.askedAt])),
  );
}

/**
 * Of `entries`, oldest first, those kept at `now`: each held, or asked
 * within 7 days; past `cap`, the lapsed go first, oldest first, then the
 * oldest, so a held entry goes only past `cap` held ones.
 */
export function keptAskedKeys(
  entries: readonly AskedKey[],
  held: Held,
  now: EpochMs,
  cap = ASKED_KEYS_KEPT,
): AskedKey[] {
  const kept = entries.filter((e) => now - e.askedAt <= ASKED_KEY_MS || held(e, e.key));
  return droppedPast(kept, cap, [(e) => !held(e, e.key), () => true]);
}

/**
 * Of `records`, oldest first, those the `retries` row keeps: past `cap`, the
 * ended go first, oldest first, then the pending ones at a key no
 * worktree's row holds. A pending request at a held key is never dropped,
 * so the row keeps more than `cap` while more than `cap` are.
 */
export function keptRetries(
  records: readonly RetryRecord[],
  held: Held,
  cap: number,
): RetryRecord[] {
  return droppedPast(records, cap, [(r) => r.end !== null, (r) => !held(r.testFile, r.key)]);
}

/** Whether any worktree's row holds a file at a key, read once per file and key. */
export function heldIn(store: Store): Held {
  const seen = new Map<string, boolean>();
  return (testFile, key) => {
    const id = testFileId(testFile);
    const at = `${id}\0${key}`;
    let held = seen.get(at);
    if (held === undefined) {
      held = store.testFileKeys.withKey(key).some((r) => testFileId(r.testFile) === id);
      seen.set(at, held);
    }
    return held;
  };
}

/** `items` less what goes past `cap`: each of `order`'s matches in turn, oldest first. */
function droppedPast<T>(
  items: readonly T[],
  cap: number,
  order: readonly ((item: T) => boolean)[],
) {
  let over = items.length - cap;
  if (over <= 0) return [...items];
  const dropped = new Set<T>();
  for (const goes of order) {
    for (const item of items) {
      if (over === 0) break;
      if (dropped.has(item) || !goes(item)) continue;
      dropped.add(item);
      over--;
    }
  }
  return items.filter((item) => !dropped.has(item));
}

function toAskedKey(value: unknown): AskedKey[] {
  if (!Array.isArray(value)) return [];
  const [project, path, key, askedAt] = value as unknown[];
  if (typeof project !== "string" || typeof path !== "string") return [];
  if (typeof key !== "string" || typeof askedAt !== "number") return [];
  return [{ project, path, key: key as CheckKey, askedAt: askedAt as EpochMs }];
}
