import { runGit, splitNul } from "../fs/git.js";
import type { StatCache } from "../hash/stat-cache.js";
import { ancestorListings, listedDirectory } from "../keys/observed.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";

/*
 * Row 011-320 (research `run-evidence.md`, difference 4 and the fifth,
 * proposed row `keep-listing-revision`): the files below the directories a
 * key lists, which `squeal code` compares across a run. A file added to or
 * removed from such a directory, at any depth, moves each listing above it;
 * no key moves during the run. The daemon reads those moves from the
 * revisions during the run: an add or a delete puts its listings in
 * `Tier.changes` (`applyBatch`), and an editor's scratch file that came or
 * went is `scratchMovedListings`' (row 011-117). `squeal code` reads no
 * revisions, and none is written where no daemon serves. So it compares
 * the files its keys held below the listings when the lookup expected the
 * run, which those listings were hashed from, with the files git sees there
 * at the run's end, tracked or untracked and not ignored. Ignored files are
 * in neither, as the watcher drops them.
 */

/** The listings among `paths`. */
export function listingsAmong(paths: Iterable<RelativePath>): Set<RelativePath> {
  const listings = new Set<RelativePath>();
  for (const path of paths) if (listedDirectory(path) !== null) listings.add(path);
  return listings;
}

/**
 * The files `cache` holds below one of `listings`, less the ignored ones
 * watched anyway (`extra`): those the keys' listings were hashed from.
 * The files below a symlinked directory (task 001-166) are left out, as
 * git lists the link alone.
 */
export function filesBelow(
  cache: StatCache,
  extra: () => readonly RelativePath[],
  listings: ReadonlySet<RelativePath>,
): ReadonlySet<RelativePath> {
  const below = new Set<RelativePath>();
  if (listings.size === 0) return below;
  const ignored = new Set(extra());
  const held = (path: RelativePath) => Boolean(cache.hashOf(path)) && !ignored.has(path);
  for (const path of cache.paths()) {
    if (held(path) && under(path, listings) && !linked(path, held)) below.add(path);
  }
  return below;
}

/**
 * The listings of `listings` a file entered or left since `before`
 * (`filesBelow`): the files git sees below them now, tracked and present or
 * untracked and not ignored, against those. A submodule and an untracked
 * repository inside the worktree are no file. A failed read throws: the
 * keeper then keeps none of the run's files.
 */
export async function listingMoves(
  root: AbsolutePath,
  before: ReadonlySet<RelativePath>,
  listings: ReadonlySet<RelativePath>,
): Promise<RelativePath[]> {
  if (listings.size === 0) return [];
  const directories = ["--", ...[...listings].map((listing) => listedDirectory(listing) || ".")];
  const files = async (args: readonly string[]) =>
    splitNul(
      await runGit(root, ["--literal-pathspecs", "ls-files", "-z", ...args, ...directories]),
    );
  const [cached, others, deleted] = await Promise.all([
    files(["--stage"]),
    files(["--others", "--exclude-standard"]),
    files(["--deleted"]),
  ]);
  const gone = new Set(deleted);
  const now = new Set<RelativePath>();
  for (const entry of cached) {
    const path = entry.slice(entry.indexOf("\t") + 1);
    if (!entry.startsWith(GITLINK) && !gone.has(path)) now.add(path);
  }
  for (const path of others) if (!path.endsWith("/")) now.add(path);
  const moved = new Set<RelativePath>();
  for (const path of [...before, ...now]) {
    if (before.has(path) === now.has(path)) continue;
    for (const listing of ancestorListings(path)) if (listings.has(listing)) moved.add(listing);
  }
  return [...moved];
}

/** The mode `git ls-files --stage` gives a submodule. */
const GITLINK = "160000 ";

function under(path: RelativePath, listings: ReadonlySet<RelativePath>): boolean {
  return ancestorListings(path).some((listing) => listings.has(listing));
}

/** Whether a directory above `path` is a file `held` names: a symlink git lists, not what is below it. */
function linked(path: RelativePath, held: (path: RelativePath) => boolean): boolean {
  for (let at = path.indexOf("/"); at >= 0; at = path.indexOf("/", at + 1)) {
    if (held(path.slice(0, at))) return true;
  }
  return false;
}
