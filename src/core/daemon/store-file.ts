import { statSync } from "node:fs";
import { readStoreMark, storePaths } from "../store/index.js";
import type { AbsolutePath } from "../types/index.js";

/** The store file a daemon opened, by device and inode. */
export interface StoreFile {
  readonly dev: number;
  readonly ino: number;
}

/** Whether `a` and `b` are one file: the same device and inode. */
export function sameFile(a: StoreFile, b: StoreFile): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

/** The file at the store's path now; `null` when there is none. */
export function storeFileOf(commonDir: AbsolutePath): StoreFile | null {
  const stat = statSync(storePaths(commonDir).database, { throwIfNoEntry: false });
  return stat === undefined ? null : { dev: stat.dev, ino: stat.ino };
}

/**
 * Why a daemon on this store stops at its heartbeat, or `null`: a failed
 * full check marked it, or a start moved the file it opened (`opened`)
 * aside, which takes the mark with it (row 011-226).
 */
export function storeCondemned(commonDir: AbsolutePath, opened?: StoreFile | null): string | null {
  const mark = readStoreMark(commonDir);
  if (mark !== null) {
    return (
      `daemon stopped: the full integrity check of the store found a fault (${mark.problem}); ` +
      "the next start moves the store aside and starts a fresh one"
    );
  }
  if (opened === undefined || opened === null) return null;
  const now = storeFileOf(commonDir);
  if (now !== null && sameFile(now, opened)) return null;
  return "daemon stopped: the store file it opened was moved aside or removed; the next start opens the store at its path";
}
