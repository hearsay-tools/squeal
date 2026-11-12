import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { runGit, splitNul } from "../fs/git.js";
import type { StatCache } from "../hash/stat-cache.js";
import { ancestorListings, listedDirectory } from "../keys/observed.js";
import { isEditorScratch } from "../scheduler/editor-scratch.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";

/*
 * Row 011-320 (difference 4; spec 011 C4 step 5, row 011-117): the editor
 * scratch files `squeal code` compares across a run. Such a file moves the
 * listing of each directory above it, and no key moves during the run; the
 * daemon reads the moves from the revisions during the run
 * (`scratchMovedListings`). `squeal code` reads no revisions, and none is
 * written where no daemon serves. So it compares the scratch files its keys
 * held when the lookup expected the run, which its listings were hashed
 * from, with those on disk at the run's end, by the same rule: a scratch
 * file that existed then and does not now, or the reverse, moves each
 * listing above it. Ignored files are in neither, as the watcher drops them.
 */

/** The listings among `paths`. */
export function listingsAmong(paths: Iterable<RelativePath>): Set<RelativePath> {
  const listings = new Set<RelativePath>();
  for (const path of paths) if (listedDirectory(path) !== null) listings.add(path);
  return listings;
}

/** The editor scratch files `cache` holds below one of `listings`: those its keys' listings name. */
export function scratchHeld(
  cache: StatCache,
  listings: ReadonlySet<RelativePath>,
): ReadonlySet<RelativePath> {
  const held = new Set<RelativePath>();
  if (listings.size === 0) return held;
  for (const path of cache.paths()) {
    if (isEditorScratch(path) && cache.hashOf(path) && below(path, listings)) held.add(path);
  }
  return held;
}

/**
 * The listings of `listings` an editor scratch file entered or left since
 * `before` (`scratchHeld`): those it names that are gone from disk, and the
 * untracked ones git does not ignore below a listing that it does not name.
 * A failed read throws: the keeper then keeps none of the run's files.
 */
export async function scratchMoves(
  root: AbsolutePath,
  before: ReadonlySet<RelativePath>,
  listings: ReadonlySet<RelativePath>,
): Promise<RelativePath[]> {
  if (listings.size === 0) return [];
  const directories = [...listings].map((listing) => listedDirectory(listing) || ".");
  const out = await runGit(root, [
    "--literal-pathspecs",
    "ls-files",
    "-z",
    "--others",
    "--exclude-standard",
    "--",
    ...directories,
  ]);
  const now = new Set(splitNul(out).filter(isEditorScratch));
  for (const path of before) if (await present(join(root, path))) now.add(path);
  const moved = new Set<RelativePath>();
  for (const path of [...before, ...now]) {
    if (before.has(path) === now.has(path)) continue;
    for (const listing of ancestorListings(path)) if (listings.has(listing)) moved.add(listing);
  }
  return [...moved];
}

function below(path: RelativePath, listings: ReadonlySet<RelativePath>): boolean {
  return ancestorListings(path).some((listing) => listings.has(listing));
}

async function present(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}
