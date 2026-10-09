import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isMissing } from "../../core/fs/index.js";
import { RACY_WINDOW_MS } from "../../core/hash/index.js";
import type { AbsolutePath, EpochMs, FileStat } from "../../core/types/index.js";

/* What is on disk of one file, for `SourceStamps` and `ConfigStamps`. */

/**
 * The kernel stamps a write from a clock that lags by under a tick (a few
 * milliseconds); a filesystem that keeps whole seconds, by up to two.
 */
const COARSE_TICK_MS = 20;

/** True when the file's last change, by `stat`, came before `at`. */
export function changedBefore(stat: FileStat, at: EpochMs): boolean {
  const wholeSeconds = stat.ctimeMs % 1000 === 0 && stat.mtimeMs % 1000 === 0;
  return stat.ctimeMs < at - (wholeSeconds ? RACY_WINDOW_MS : COARSE_TICK_MS);
}

/** The stat, then the bytes' hash; `null` when the file is gone. */
export async function readStamp(
  file: AbsolutePath,
): Promise<{ stat: FileStat; hash: string } | null> {
  const stat = await statOrNull(file);
  if (stat === null) return null;
  try {
    return {
      stat,
      hash: createHash("sha1")
        .update(await readFile(file))
        .digest("hex"),
    };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export async function statOrNull(file: AbsolutePath): Promise<FileStat | null> {
  try {
    const s = await lstat(file);
    return { mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, size: s.size, inode: s.ino };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
