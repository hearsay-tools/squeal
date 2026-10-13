import { testFileId } from "../keys/index.js";
import {
  type Consumer,
  type RelativePath,
  type Store,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";
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
 * test files or in one of their recorded closures; another worktree's test
 * files do not count. Paths under `dist/` and paths `exists` says are gone
 * are left out. Empty until the daemon has listed the worktree's test files,
 * and while one of them has no recorded closure, since what it reads is not
 * known then.
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
    const key = uncoveredMetaKey(consumer.worktreeId);
    const told = toldPaths(readSlot(store, key, consumer));
    const fresh = code.filter((p) => !read.has(p) && !told.has(p) && exists(p));
    if (fresh.length > 0) writeSlot(store, key, consumer, [...told, ...fresh]);
    return fresh;
  });
}

/** Every path a listed test file of the worktree is or reads; `null` while one is not known. */
function readByTests(store: Store, worktreeId: WorktreeId): Set<RelativePath> | null {
  const listed = store.testFileKeys.list(worktreeId);
  if (listed.length === 0) return null;
  const ids = new Set(listed.map((row) => testFileId(row.testFile)));
  const read = new Set<RelativePath>(listed.map((row) => row.testFile.path));
  let closures = 0;
  for (const record of store.testFiles.list()) {
    if (!ids.has(testFileId(record.testFile))) continue;
    closures++;
    for (const path of record.closure.paths) read.add(path);
  }
  return closures < ids.size ? null : read;
}

function toldPaths(value: unknown): Set<RelativePath> {
  return new Set(
    Array.isArray(value) ? value.filter((p): p is string => typeof p === "string") : [],
  );
}
