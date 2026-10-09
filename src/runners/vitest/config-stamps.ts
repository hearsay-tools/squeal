import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { mapConcurrent } from "../../core/fs/index.js";
import { isRacy, sameStat } from "../../core/hash/index.js";
import type { AbsolutePath, EpochMs, FileStat } from "../../core/types/index.js";
import type { WorktreePaths } from "./paths.js";
import { changedBefore, readStamp, statOrNull } from "./stamp.js";

/** A script at the root: where config files and the files they import usually sit. */
const ROOT_SCRIPT = /\.[cm]?[jt]sx?$/;

interface Stamp {
  readonly stat: FileStat;
  readonly hash: string;
  readonly hashedAt: EpochMs;
}

/**
 * Task 001-157: a Vitest instance reads its config files once, as it is
 * created, and never through a plugin container, so `SourceStamps` cannot
 * stamp them. These stamps are taken before `createVitest` reads them: the
 * last instance's config files, and the scripts at the root, which is where
 * a first instance's usually are. After creation, `unsure` names each
 * config file the instance may have read other bytes of than those on disk:
 * stamped and moved since, or not stamped and changed since the stamps
 * were taken.
 */
export class ConfigStamps {
  private constructor(
    private readonly takenAt: EpochMs,
    private readonly stamps: ReadonlyMap<AbsolutePath, Stamp>,
  ) {}

  static async take(
    paths: WorktreePaths,
    known: Iterable<AbsolutePath>,
    now: () => EpochMs = Date.now,
  ): Promise<ConfigStamps> {
    const takenAt = now();
    const files = new Set([...known, ...(await rootScripts(paths))]);
    const stamps = new Map<AbsolutePath, Stamp>();
    await mapConcurrent([...files], async (file) => {
      const hashedAt = now();
      const read = await readStamp(file);
      if (read !== null) stamps.set(file, { ...read, hashedAt });
    });
    return new ConfigStamps(takenAt, stamps);
  }

  async unsure(files: Iterable<AbsolutePath>): Promise<AbsolutePath[]> {
    const list = [...files];
    const moved = await mapConcurrent(list, async (file) => {
      const stat = await statOrNull(file);
      const stamp = this.stamps.get(file);
      if (stat === null) return true;
      if (!stamp) return !changedBefore(stat, this.takenAt);
      if (!sameStat(stat, stamp.stat)) return true;
      return isRacy(stamp.stat, stamp.hashedAt) && (await readStamp(file))?.hash !== stamp.hash;
    });
    return list.filter((_, i) => moved[i]).sort();
  }
}

async function rootScripts(paths: WorktreePaths): Promise<AbsolutePath[]> {
  const entries = await readdir(paths.root, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && ROOT_SCRIPT.test(e.name))
    .map((e) => join(paths.root, e.name) as AbsolutePath);
}
