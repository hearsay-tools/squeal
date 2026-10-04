import { stat as fsStat } from "node:fs/promises";
import { join } from "node:path";
import type { AbsolutePath, EpochMs, FileHash, FileStat, RelativePath } from "../types/index.js";
import { hashFile, isMissing, type ObjectFormat } from "./blob.js";
import { mapConcurrent } from "./concurrency.js";
import { readCleanIndexHashes } from "./git-index.js";
import { isRacy, type StatCache, sameStat } from "./stat-cache.js";

/**
 * Filesystem access for reconciliation, relative to one worktree root. Tests
 * substitute a fake to count or script reads.
 */
export interface Hasher {
  /** Stat of a regular file (symlinks followed), or `null` when there is none. */
  stat(path: RelativePath): Promise<FileStat | null>;
  /** Blob id of the file's bytes, or `null` when it does not exist. */
  hash(path: RelativePath): Promise<FileHash | null>;
  /** Wall clock, for the racy check. */
  now(): EpochMs;
}

export function createFsHasher(root: AbsolutePath, format: ObjectFormat): Hasher {
  return {
    async stat(path) {
      try {
        const stats = await fsStat(join(root, path));
        if (!stats.isFile()) return null;
        return {
          mtimeMs: stats.mtimeMs,
          ctimeMs: stats.ctimeMs,
          size: stats.size,
          inode: stats.ino,
        };
      } catch (error) {
        if (isMissing(error)) return null;
        throw new Error(`squeal: cannot stat ${path} in ${root}: ${(error as Error).message}`);
      }
    },
    hash: (path) => hashFile(join(root, path), format),
    now: () => Date.now(),
  };
}

export interface SeedOptions {
  readonly objectFormat: ObjectFormat;
  /** Defaults to `createFsHasher(root, objectFormat)`. */
  readonly hasher?: Hasher;
}

export interface SeedReport {
  /** Hashes taken from the git index. */
  readonly fromIndex: number;
  /** Hashes computed from bytes. */
  readonly fromBytes: number;
  /** Paths with no regular file; left out of the cache. */
  readonly missing: number;
}

/**
 * Fills `cache` with the stat and hash of each path, taking hashes from the
 * git index where `readCleanIndexHashes` allows it.
 *
 * Research R4: "One `git ls-files -s` plus `git status` [...] yields every
 * file hash." Every path is stat'ed before and after the git read; an index
 * oid is used only when both stats agree, so a write during the read falls
 * back to hashing the bytes.
 */
export async function seedStatCache(
  cache: StatCache,
  root: AbsolutePath,
  paths: readonly RelativePath[],
  options: SeedOptions,
): Promise<SeedReport> {
  const hasher = options.hasher ?? createFsHasher(root, options.objectFormat);
  const before = await mapConcurrent(paths, (path) => hasher.stat(path));
  const index = await readCleanIndexHashes(root);
  let fromIndex = 0;
  let fromBytes = 0;
  let missing = 0;

  await mapConcurrent(paths, async (path, i) => {
    const stat = await hasher.stat(path);
    const earlier = before[i];
    const indexHash = index.get(path);
    if (stat && earlier && indexHash !== undefined && sameStat(stat, earlier)) {
      cache.set({ path, ...stat, hash: indexHash }, { racy: isRacy(stat, hasher.now()) });
      fromIndex++;
      return;
    }
    const hashedAt = hasher.now();
    const hash = stat ? await hasher.hash(path) : null;
    if (!stat || hash === null) {
      cache.delete(path);
      missing++;
      return;
    }
    cache.set({ path, ...stat, hash }, { racy: isRacy(stat, hashedAt) });
    fromBytes++;
  });
  return { fromIndex, fromBytes, missing };
}
