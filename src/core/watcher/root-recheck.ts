import { type Dir, opendirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AbsolutePath, WatchHint } from "../types/index.js";
import type { Exclusions } from "./exclusions.js";

/**
 * How close to its file's timestamps a signature is racy: two seconds, the
 * coarsest common tick (FAT), well above a kernel's coarse clock (a jiffy).
 */
export const RACY_NS = 2_000_000_000n;

/**
 * The directory entries one root batch may stat. A directory a build fills
 * with thousands of files is left, past this, to the reconciliation pass.
 */
export const ENTRY_BUDGET = 1024;

/**
 * The directory entries one root batch may read, skipped ones included: a
 * directory of thousands of subdirectories or excluded files is left, past
 * this, to the reconciliation pass too (review wave 13aa, S1).
 */
export const READ_BUDGET = 4096;

/**
 * Finds the events @parcel/watcher erased from the root watch (001-236).
 *
 * Its Watcher::triggerCallbacks copies the pending events, then clears them,
 * and an event added between the two is never delivered (2.6.0; 001-235).
 * The erased write happened after the previous batch was taken and before
 * this one is delivered, and a write that loses its event this way lands
 * beside another the batch names: a rebuild or a save writes a directory's
 * files together. So each root batch lists the directories its events name
 * and reports every file there, not excluded and not named, whose mtime or
 * ctime is no older than the previous batch, less {@link RACY_NS}: a coarse
 * tick, as git's racy rule allows, and the delay before the previous batch
 * reached this callback. It reads no content, so a same-size rewrite inside
 * one tick is reported too, and a file written for the next batch is
 * reported early, a duplicate the reconciler drops.
 *
 * What it cannot see is left to the reconciliation pass (D2): an erased
 * removal, an erased event in a directory the batch does not name, and the
 * entries past {@link ENTRY_BUDGET} stats or {@link READ_BUDGET} reads.
 */
export class RootRecheck {
  private since: bigint;

  constructor(private readonly exclusions: Exclusions) {
    this.since = nowNs();
  }

  /** The hints for the files beside `named` written since the previous batch. */
  find(named: ReadonlySet<AbsolutePath>): WatchHint[] {
    const after = this.since - RACY_NS;
    this.since = nowNs();
    const dirs = new Set([...named].map((path) => dirname(path)));
    const hints: WatchHint[] = [];
    let stats = ENTRY_BUDGET;
    let reads = READ_BUDGET;
    for (const dir of dirs) {
      if (this.exclusions.excludes(dir)) continue;
      let handle: Dir;
      try {
        handle = opendirSync(dir);
      } catch {
        continue;
      }
      try {
        while (stats > 0 && reads > 0) {
          const entry = handle.readSync();
          reads--;
          if (entry === null) break;
          if (entry.isDirectory()) continue;
          const path = join(dir, entry.name);
          if (named.has(path) || this.exclusions.excludes(path)) continue;
          stats--;
          if (written(path, after)) hints.push({ path, kind: "change" });
        }
      } catch {
        // A directory removed while it is listed: its batch named it, and the rest is reconciled.
      } finally {
        try {
          handle.closeSync();
        } catch {}
      }
      if (stats === 0 || reads === 0) break;
    }
    return hints;
  }
}

function nowNs(): bigint {
  return BigInt(Date.now()) * 1_000_000n;
}

/**
 * Whether `path` is a file whose mtime or ctime is no older than `after`; a
 * stat that fails for another reason than its absence is reported, never
 * trusted as unwritten.
 */
function written(path: AbsolutePath, after: bigint): boolean {
  try {
    const stat = statSync(path, { bigint: true, throwIfNoEntry: false });
    if (!stat || stat.isDirectory()) return false;
    return stat.mtimeNs >= after || stat.ctimeNs >= after;
  } catch {
    return true;
  }
}
