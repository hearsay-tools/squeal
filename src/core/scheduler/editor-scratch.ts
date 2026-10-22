import { ancestorListings, listedDirectory } from "../keys/index.js";
import type {
  FileChange,
  RelativePath,
  RevisionNumber,
  Store,
  WorktreeId,
} from "../types/index.js";
import type { SchedulerContext } from "./context.js";
import type { ObservedGrowth } from "./observed.js";
import type { Tier } from "./tiers.js";

/*
 * Spec 011 C4 step 5 as amended 2026-10-22 (row 011-117,
 * `research/edit-latency.md` 3 and 6.2, `research/watch-mode-comparison.md`
 * 3): the files an editor writes beside the file it opens. Untracked and not
 * ignored, they change their directory's listing, so each test file that
 * lists it re-keys as before. Such a change cancels no tier in flight and
 * starts no quiet: in toolkit-dev four vim opens and quits threw away 138 s
 * of runs and added about 57 s of quiet. The completion barrier compares the
 * listing at the run's end instead (`scratchUnstable`).
 */

/** Vim's swap file `.<name>.swp`, and `.swo` down to `.swa` when that name is taken. */
const VIM_SWAP = /^\..+\.sw[a-p]$/;
/** The file vim creates and deletes to learn whether it may write in a directory. */
const VIM_PROBE = "4913";
/** Emacs's lock file `.#<name>`. */
const EMACS_LOCK = /^\.#./;

/** Whether `path` is named as an editor's scratch file: vim's swap or probe, emacs's lock. */
export function isEditorScratch(path: RelativePath): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name === VIM_PROBE || VIM_SWAP.test(name) || EMACS_LOCK.test(name);
}

/** Whether every change of a revision is an editor scratch file's. */
export function onlyEditorScratch(changes: readonly FileChange[]): boolean {
  return changes.length > 0 && changes.every((change) => isEditorScratch(change.path));
}

/**
 * The listings among `listings` whose entries editor scratch files moved
 * between revision `after`, at which a tier was selected, and the latest
 * one: a scratch file that existed then and does not now, or the reverse.
 * A scratch file's add or delete during the run moves no listing in
 * `Tier.changes`, so the barrier asks this at the run's end; one created and
 * removed during the run leaves its listings as they were. `changed`, the
 * paths the revisions during the run changed, holds every scratch file
 * itself, so without one there the revisions are not read.
 */
export function scratchMovedListings(
  store: Store,
  worktreeId: WorktreeId,
  after: RevisionNumber,
  changed: ReadonlySet<RelativePath>,
  listings: ReadonlySet<RelativePath>,
): RelativePath[] {
  if (listings.size === 0 || ![...changed].some(isEditorScratch)) return [];
  const existed = new Map<RelativePath, boolean>();
  const exists = new Map<RelativePath, boolean>();
  for (const revision of store.revisions.range(worktreeId, after, Number.MAX_SAFE_INTEGER)) {
    for (const { path, oldHash, newHash } of revision.changes) {
      if (!isEditorScratch(path)) continue;
      if (!existed.has(path)) existed.set(path, oldHash !== null);
      exists.set(path, newHash !== null);
    }
  }
  const moved = new Set<RelativePath>();
  for (const [path, before] of existed) {
    if (exists.get(path) === before) continue;
    for (const listing of ancestorListings(path)) if (listings.has(listing)) moved.add(listing);
  }
  return [...moved];
}

/**
 * The listings that `tier`'s files hold, or that its run observed first
 * (`growth`, review `reviews/0.1.268.md` B1), which editor scratch files
 * moved during the run (`scratchMovedListings`): unstable paths for the
 * completion barrier. Asked under the scheduler lock as the run is
 * recorded, so every batch applied before the record counts, as it does in
 * `Tier.changes`.
 */
export function scratchUnstable(
  context: SchedulerContext,
  tier: Pick<Tier, "files" | "changes" | "revision">,
  growth: ReadonlyMap<string, ObservedGrowth> = new Map(),
): RelativePath[] {
  const listings = new Set<RelativePath>();
  const add = (paths: readonly RelativePath[]) => {
    for (const path of paths) if (listedDirectory(path) !== null) listings.add(path);
  };
  for (const file of tier.files) add(file.inputs);
  for (const grown of growth.values()) add(grown.growth);
  const { store, worktreeId } = context;
  return scratchMovedListings(store, worktreeId, tier.revision.number, tier.changes, listings);
}
