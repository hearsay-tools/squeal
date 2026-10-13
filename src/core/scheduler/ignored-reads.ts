import { compare, isRecord } from "../fs/index.js";
import {
  type RelativePath,
  type RevisionNumber,
  type Store,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";

/*
 * Spec 005 D3 and open question 6, task 001-307: the gitignored worktree
 * paths each test file read or spawned during a warm-up, a `run --all`
 * checkpoint requested with `observeIgnored`. Setup shows them as unkeyed
 * suggestions for `inputs`. One JSON row per worktree, replaced by each such
 * checkpoint: never in a key, a closure, a result or a revision, so a change
 * of one of these paths re-runs nothing (001 D4 as amended).
 */

/** The most paths kept per test file; `more` counts the rest. */
export const IGNORED_READS_CAP = 50;

/** One test file's ignored paths: sorted, the first `IGNORED_READS_CAP`, and how many more. */
export interface IgnoredReadsOfFile {
  readonly paths: readonly RelativePath[];
  readonly more: number;
}

/** The last warm-up's ignored paths, by `testFileId` (`<project>\0<path>`). */
export interface IgnoredReads {
  /** The id of the checkpoint the `run-all` request created. */
  readonly checkpoint: string;
  /** The revision it was requested at. */
  readonly revision: RevisionNumber;
  readonly files: Readonly<Record<string, IgnoredReadsOfFile>>;
}

/** `meta` key of a worktree's ignored-paths record. */
export function ignoredReadsMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("ignoredReads", worktreeId);
}

/** The last warm-up's record, as far as it got; `null` when none ran or the row is unreadable. */
export function readIgnoredReads(store: Store, worktreeId: WorktreeId): IgnoredReads | null {
  const raw = store.meta.get(ignoredReadsMetaKey(worktreeId));
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.checkpoint !== "string") return null;
  if (typeof value.revision !== "number" || !isRecord(value.files)) return null;
  const files: Record<string, IgnoredReadsOfFile> = {};
  for (const [id, file] of Object.entries(value.files)) {
    if (!isRecord(file) || !Array.isArray(file.paths) || typeof file.more !== "number") continue;
    files[id] = { paths: file.paths.filter((p) => typeof p === "string"), more: file.more };
  }
  return { checkpoint: value.checkpoint, revision: value.revision as RevisionNumber, files };
}

/** A warm-up's checkpoint starts: its record replaces the last one, with no file yet. */
export function startIgnoredReads(
  store: Store,
  worktreeId: WorktreeId,
  checkpoint: string,
  revision: RevisionNumber,
): void {
  const record: IgnoredReads = { checkpoint, revision, files: {} };
  store.meta.set(ignoredReadsMetaKey(worktreeId), JSON.stringify(record));
}

/**
 * Adds one tier's files to `checkpoint`'s record, each file's list as its
 * latest run read it, capped. A record of another checkpoint is left as it is.
 */
export function addIgnoredReads(
  store: Store,
  worktreeId: WorktreeId,
  checkpoint: string,
  read: ReadonlyMap<string, readonly RelativePath[]>,
): void {
  const record = readIgnoredReads(store, worktreeId);
  if (record === null || record.checkpoint !== checkpoint || read.size === 0) return;
  const files = { ...record.files };
  for (const [id, paths] of read) files[id] = capped(paths);
  store.meta.set(ignoredReadsMetaKey(worktreeId), JSON.stringify({ ...record, files }));
}

function capped(paths: readonly RelativePath[]): IgnoredReadsOfFile {
  const sorted = [...new Set(paths)].sort(compare);
  return {
    paths: sorted.slice(0, IGNORED_READS_CAP),
    more: Math.max(0, sorted.length - IGNORED_READS_CAP),
  };
}
