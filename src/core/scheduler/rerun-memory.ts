import { testFileId } from "../keys/index.js";
import type { CheckKey, Store, TestFileRef, WorktreeId } from "../types/index.js";

/*
 * Review wave 13i, S1 (task 001-187): the key each file's new failure was
 * re-run at (`FileState.rerunKey`) and whether that re-run is still to come
 * (`FileState.rerunPending`) outlive the daemon. A daemon that exits between
 * the failure and its re-run leaves a current own fail, which the next
 * baseline's lookup takes; this row tells that baseline to queue the re-run
 * forced (`restoreReruns`). One entry per test file, the latest.
 */

/** One test file's re-run: the key it was queued at, and whether it is still to run. */
export interface RerunMemory {
  readonly testFile: TestFileRef;
  readonly key: CheckKey;
  readonly pending: boolean;
}

/** `meta` key of a worktree's re-runs, a JSON array of `RerunMemory`. */
export function rerunsMetaKey(worktreeId: WorktreeId): string {
  return `reruns:${worktreeId}`;
}

/** The worktree's re-runs by `testFileId`; empty when the row is absent or does not parse. */
export function readReruns(store: Store, worktreeId: WorktreeId): Map<string, RerunMemory> {
  const raw = store.meta.get(rerunsMetaKey(worktreeId));
  if (raw === null) return new Map();
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return new Map();
    return new Map(value.filter(isMemory).map((m) => [testFileId(m.testFile), m]));
  } catch {
    return new Map();
  }
}

/** Writes `entries` over the worktree's re-runs of the same files. */
export function writeReruns(
  store: Store,
  worktreeId: WorktreeId,
  entries: readonly RerunMemory[],
): void {
  if (entries.length === 0) return;
  store.transaction(() => {
    const reruns = readReruns(store, worktreeId);
    for (const entry of entries) reruns.set(testFileId(entry.testFile), entry);
    store.meta.set(rerunsMetaKey(worktreeId), JSON.stringify([...reruns.values()]));
  });
}

/** Keeps only the re-runs of `kept` files (`testFileId`s): a removed file's memory goes. */
export function pruneReruns(store: Store, worktreeId: WorktreeId, kept: ReadonlySet<string>): void {
  const reruns = readReruns(store, worktreeId);
  const left = [...reruns].filter(([id]) => kept.has(id)).map(([, m]) => m);
  if (left.length === reruns.size) return;
  store.meta.set(rerunsMetaKey(worktreeId), JSON.stringify(left));
}

function isMemory(value: unknown): value is RerunMemory {
  if (typeof value !== "object" || value === null) return false;
  const { testFile, key, pending } = value as Record<string, unknown>;
  if (typeof key !== "string" || typeof pending !== "boolean") return false;
  if (typeof testFile !== "object" || testFile === null) return false;
  const { project, path } = testFile as Record<string, unknown>;
  return typeof project === "string" && typeof path === "string";
}
