import { runGit, splitNul } from "../fs/git.js";
import type { StatCache } from "../hash/stat-cache.js";
import { ancestorListings, listedDirectory } from "../keys/observed.js";
import { isEditorScratch, scratchMovedListings } from "../scheduler/editor-scratch.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import { linkedFiles } from "../watcher/linked-files.js";
import type { RevisionsSince } from "./run-evidence.js";

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
 * at the run's end, tracked or untracked and not ignored, and those below
 * the symlinked directories the watcher follows (review 0.1.458 B2). Ignored
 * files are in neither, as the watcher drops them. Where a daemon serves,
 * its revisions during the run add what came and went (`changedDuring`).
 */

/** The listings among `paths`. */
export function listingsAmong(paths: Iterable<RelativePath>): Set<RelativePath> {
  const listings = new Set<RelativePath>();
  for (const path of paths) if (listedDirectory(path) !== null) listings.add(path);
  return listings;
}

/**
 * The files `cache` holds below one of `listings`, less the ignored ones
 * watched anyway (`extra`): those the keys' listings were hashed from,
 * the files below a followed symlinked directory among them (task 001-166:
 * the keys' start seed hashes what `linkedFiles` walks).
 */
export function filesBelow(
  cache: StatCache,
  extra: () => readonly RelativePath[],
  listings: ReadonlySet<RelativePath>,
): ReadonlySet<RelativePath> {
  const below = new Set<RelativePath>();
  if (listings.size === 0) return below;
  const ignored = new Set(extra());
  for (const path of cache.paths()) {
    if (cache.hashOf(path) && !ignored.has(path) && under(path, listings)) below.add(path);
  }
  return below;
}

/**
 * The listings of `listings` a file entered or left since `before`
 * (`filesBelow`): the files git sees below them now, tracked and present or
 * untracked and not ignored, and the files below the symlinked directories
 * among those that the watcher follows, by its own scope (`linkedFiles`,
 * with the ignored files watched anyway, `extra`), against those. A
 * submodule and an untracked repository inside the worktree are no file. A
 * failed read throws: the keeper then keeps none of the run's files.
 */
export async function listingMoves(
  root: AbsolutePath,
  before: ReadonlySet<RelativePath>,
  listings: ReadonlySet<RelativePath>,
  extra: () => readonly RelativePath[],
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
  // The links git tracks, and every untracked path, which may be one.
  const links: RelativePath[] = [];
  for (const entry of cached) {
    const path = entry.slice(entry.indexOf("\t") + 1);
    if (entry.startsWith(GITLINK) || gone.has(path)) continue;
    now.add(path);
    if (entry.startsWith(SYMLINK)) links.push(path);
  }
  for (const path of others) {
    if (path.endsWith("/")) continue;
    now.add(path);
    links.push(path);
  }
  if (links.length > 0) {
    for (const path of await linkedFiles(root, links, extra())) {
      if (under(path, listings)) now.add(path);
    }
  }
  const moved = new Set<RelativePath>();
  for (const path of [...before, ...now]) {
    if (before.has(path) === now.has(path)) continue;
    for (const listing of ancestorListings(path)) if (listings.has(listing)) moved.add(listing);
  }
  return [...moved];
}

/**
 * Review 0.1.458 B1: what the revisions a serving daemon recorded during
 * the run changed, as `applyBatch` adds them to a tier in flight (its
 * `Tier.changes`): each path, and for an add or delete every listing above
 * it, but an editor's scratch file's only as `scratchMovedListings` finds
 * them among `listings`, by whether it was there before and is now. So a
 * file that came and went during the run moves its listings here, while
 * the files below them before and after the run are the same.
 */
export function changedDuring(
  revisions: RevisionsSince | undefined,
  listings: ReadonlySet<RelativePath>,
): RelativePath[] {
  if (revisions === undefined) return [];
  const { store, worktreeId, after } = revisions;
  const changes = new Set<RelativePath>();
  for (const revision of store.revisions.range(worktreeId, after, Number.MAX_SAFE_INTEGER)) {
    for (const change of revision.changes) {
      changes.add(change.path);
      const structural = change.oldHash === null || change.newHash === null;
      if (!structural || isEditorScratch(change.path)) continue;
      for (const listing of ancestorListings(change.path)) changes.add(listing);
    }
  }
  const scratch = scratchMovedListings(store, worktreeId, after, changes, listings);
  return [...changes, ...scratch];
}

/** The modes `git ls-files --stage` gives a submodule and a symbolic link. */
const GITLINK = "160000 ";
const SYMLINK = "120000 ";

function under(path: RelativePath, listings: ReadonlySet<RelativePath>): boolean {
  return ancestorListings(path).some((listing) => listings.has(listing));
}
