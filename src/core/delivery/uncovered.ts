import {
  type Consumer,
  type RelativePath,
  type Store,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";
import { closureFor } from "./closure.js";
import { changedAfter, registration } from "./registered.js";
import { readSlot, writeSlot } from "./slots.js";

/** Code files a test could read; docs, config and data edits never get the line. */
const CODE = /\.(?:[cm]?[jt]sx?|py)$/;

/** `meta` key of the code paths each consumer of a worktree was told no test reads. */
export function uncoveredMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("uncoveredTold", worktreeId);
}

/**
 * Spec 001 D9 as amended (task 001-292, experiment C1 of
 * `research/uncovered-trust.md`): the code files changed since `consumer`
 * registered that no test Squeal runs reads, each named once per consumer,
 * recorded as told. A path is covered when it is one of the worktree's listed
 * test files or in one of their closures, as D6 trusts them (`closureFor`):
 * another worktree's test files do not count, nor does its closure of a
 * shared test file at another key (review wave 13as, B1). Paths under
 * `dist/` and paths `exists` says are gone are left out. Empty until the
 * daemon has listed the worktree's test files, and while one of them has no
 * closure this worktree can trust, since what it reads is not known then.
 */
export function tellUncovered(
  store: Store,
  consumer: Consumer,
  exists: (path: RelativePath) => boolean,
): readonly RelativePath[] {
  return store.transaction(() => {
    const r = registration(store, consumer);
    const latest = store.revisions.latest(consumer.worktreeId);
    if (r === null || latest === null) return [];
    const { changed } = changedAfter(store, consumer.worktreeId, r, latest.number);
    const code = [...changed].filter(
      (p) => CODE.test(p) && !p.startsWith("dist/") && !p.includes("/dist/"),
    );
    if (code.length === 0) return [];
    const read = readByTests(store, consumer.worktreeId);
    if (read === null) return [];
    const told = uncoveredTold(store, consumer);
    const fresh = code.filter((p) => !read.has(p) && !told.includes(p) && exists(p));
    if (fresh.length > 0) recordUncoveredTold(store, consumer, [...told, ...fresh]);
    return fresh;
  });
}

/** The paths `consumer` was told, for `park` to keep while it is away (review wave 13as, B2). */
export function uncoveredTold(store: Store, consumer: Consumer): readonly RelativePath[] {
  const value = readSlot(store, uncoveredMetaKey(consumer.worktreeId), consumer);
  return Array.isArray(value) ? value.filter((p): p is string => typeof p === "string") : [];
}

/**
 * Records `told` as the paths `consumer` was told; empty forgets them. A
 * registration taken up from its parked one calls it with the paths parked.
 * Call inside a transaction.
 */
export function recordUncoveredTold(
  store: Store,
  consumer: Consumer,
  told: readonly RelativePath[],
): void {
  const key = uncoveredMetaKey(consumer.worktreeId);
  if (told.length > 0) writeSlot(store, key, consumer, told);
  else if (readSlot(store, key, consumer) !== undefined) writeSlot(store, key, consumer, null);
}

/** Every path a listed test file of the worktree is or reads; `null` while one is not known. */
function readByTests(store: Store, worktreeId: WorktreeId): Set<RelativePath> | null {
  const listed = store.testFileKeys.list(worktreeId);
  if (listed.length === 0) return null;
  const closureOf = closureFor(store, worktreeId);
  const read = new Set<RelativePath>();
  for (const { testFile } of listed) {
    const closure = closureOf(testFile);
    if (closure === undefined) return null;
    read.add(testFile.path);
    for (const path of closure) read.add(path);
  }
  return read;
}
