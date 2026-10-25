import { GIT_ENTRY, listedDirectory, listingPath, testFileId } from "../keys/index.js";
import type { RelativePath, RunReport, TestFileRef } from "../types/index.js";
import { checkIgnored } from "../watcher/git.js";
import type { SchedulerContext } from "./context.js";
import type { EnvironmentGrowth } from "./environment-growth.js";
import { linkTargets } from "./link-target.js";
import { changedSince, snapshotInputs } from "./stability.js";

/** What one completed file's run adds to its closure (task 001-132). */
export interface ObservedGrowth {
  /** Newly observed paths to merge into the shared set; listing paths among them. */
  readonly add: readonly RelativePath[];
  /**
   * Every observed path its closure lacks: `add` and what other worktrees
   * observed since the closure was assembled. The stability check covers them.
   */
  readonly growth: readonly RelativePath[];
  /**
   * The file paths of `growth` the stat cache first hashed after the run
   * began, and the listings of git-ignored directories in `add`, whose names
   * the record reads from disk (row 016-23): no evidence from before the run
   * holds them, so no key with them can certify this run's result (review
   * wave 12d, B1; task 001-134).
   */
  readonly firstSeen: readonly RelativePath[];
}

/**
 * Prepares a tier's observations for `recordTier`, outside the lock: per
 * completed file (by `testFileId`), the paths the runner observed beyond the
 * file's closure, with what other worktrees stored meanwhile (D3, D5 as
 * amended; research observed-runtime-inputs F3, F4), a recursive listing as
 * the listing of each directory below it, and a path read through a directory
 * link with its target (`linkTargets`). A path git ignores is kept, and
 * watched as an extra file, unless the run wrote, created or removed one of
 * its ancestor directories (`ObservedInputs.written`; 016 D4, the
 * written-directory bound): those are the run's own scratch. Every file path
 * is hashed into the stat cache, so the keys `recordTier` computes have no
 * untracked path; a path hashed only now, after its read and after run `run`
 * (`WorktreeKeys.beginRun`) began, is `firstSeen`, except `.git`, which keys
 * by its kind, and so is a listing of a git-ignored directory the run adds,
 * whose names are read from disk as the record keys it (row 016-23). Only a
 * project `keys.observes` (policy `observe.runtimeInputs`, or module loads,
 * 016 D4 O8) gives growth. What a process the file started imported
 * (`ObservedInputs.direct`) marks it direct in the keys' view, a closure path
 * too, unless the bound drops it; the record stores the marks. The names a
 * listed directory the watcher sees no file in holds now are the run's own
 * when the file alone lists it (`WorktreeKeys.listedByRun`, row 016-24).
 */
export async function observedGrowth(
  context: Pick<SchedulerContext, "root" | "keys">,
  report: RunReport,
  run: number,
): Promise<Map<string, ObservedGrowth>> {
  const out = new Map<string, ObservedGrowth>();
  const { keys } = context;
  const reported = (report.observed ?? []).filter((o) => keys.observes(o.testFile.project));
  if (reported.length === 0) return out;
  keys.refreshObserved(reported.map((o) => o.testFile.project));
  const candidates = new Set<RelativePath>();
  const seen = [];
  for (const observed of reported) {
    // Row 016-24: the names a listed ignored directory holds now are this run's own.
    keys.listedByRun(observed.testFile, observed.directories);
    const closure = new Set(keys.index.closure(observed.testFile)?.paths ?? []);
    const listed = new Set(observed.directories.map(listingPath));
    // A recursive listing returned names from every directory below it (B5, task 001-134).
    for (const root of observed.recursive ?? []) {
      for (const path of keys.listingsBelow(root)) listed.add(path);
    }
    const read = observed.paths.filter((path) => !closure.has(path));
    const targets = await linkTargets(context.root, read);
    const fresh = [...new Set([...read, ...targets, ...listed])].filter(
      (path) => !closure.has(path),
    );
    for (const path of fresh) candidates.add(listedDirectory(path) ?? path);
    seen.push({ observed, closure, fresh });
  }
  const ignored = await checkIgnored(
    context.root,
    [...candidates].filter((p) => p !== ""),
  );
  const tracked: RelativePath[] = [];
  const grown: { testFile: TestFileRef; add: RelativePath[]; growth: RelativePath[] }[] = [];
  for (const { observed, closure, fresh } of seen) {
    const scratch = scratchOf(observed.written ?? [], ignored);
    const add = fresh.filter((path) => !scratch(listedDirectory(path) ?? path));
    const kept = new Set([...closure, ...add]);
    keys.markDirect(
      observed.testFile,
      (observed.direct ?? []).filter((path) => kept.has(path)),
    );
    const known = keys.observedOf(observed.testFile).filter((path) => !closure.has(path));
    const growth = [...new Set([...known, ...add])];
    if (growth.length === 0) continue;
    for (const path of growth) if (listedDirectory(path) === null) tracked.push(path);
    grown.push({ testFile: observed.testFile, add, growth });
  }
  // One call, so the extra files the record adds swap the watcher once (011-187).
  await keys.track(tracked);
  for (const { testFile, add, growth } of grown) {
    // `.git` keys by its kind, read with the key, not by the bytes hashed now (task 001-262).
    const hashed = growth.filter(
      (path) =>
        listedDirectory(path) === null &&
        path !== GIT_ENTRY &&
        keys.firstHashedDuringRun(path, run),
    );
    const firstSeen = [...hashed, ...ignoredListings(add, ignored)];
    out.set(testFileId(testFile), { add, growth, firstSeen });
  }
  return out;
}

/** The listings among `paths` whose directory git ignores (row 016-23). */
function ignoredListings(
  paths: readonly RelativePath[],
  ignored: ReadonlySet<RelativePath>,
): RelativePath[] {
  return paths.filter((path) => {
    const directory = listedDirectory(path);
    return directory !== null && ignored.has(directory);
  });
}

/**
 * 016 D4, the written-directory bound: whether `path` is a git-ignored path
 * below a directory in `written`, which the run wrote, created or removed.
 * The warm-up reads it too, so it names no path the record keys.
 */
export function scratchOf(
  written: readonly RelativePath[],
  ignored: ReadonlySet<RelativePath>,
): (path: RelativePath) => boolean {
  const dirs = new Set(written);
  return (path) => {
    if (!ignored.has(path) || dirs.size === 0) return false;
    for (let at = path.lastIndexOf("/"); at > 0; at = path.lastIndexOf("/", at - 1)) {
      if (dirs.has(path.slice(0, at))) return true;
    }
    return false;
  };
}

/** A tier's observations, prepared for `recordTier` under the lock. */
export interface TierObservations {
  /** Per completed file (`testFileId`). */
  readonly growth: ReadonlyMap<string, ObservedGrowth>;
  /** Growth paths whose content on disk differs from the stat cache. */
  readonly changed: ReadonlySet<RelativePath>;
  /** Growth paths written since the stat cache read them, their bytes as they were (task 001-168). */
  readonly touched: ReadonlySet<RelativePath>;
  /** Environment files the run loaded beyond the keyed environments (task 003-43). */
  readonly environment?: EnvironmentGrowth;
}

export const NOTHING_OBSERVED: TierObservations = {
  growth: new Map(),
  changed: new Set(),
  touched: new Set(),
};

/**
 * `observedGrowth`, and which of its file paths changed on disk since the
 * stat cache read them, or were written and ended as they were: the
 * stability check of D5 and the completion barrier (task 001-168) for paths
 * the tier's snapshot did not hold. A listing is checked against the
 * revisions during the run (`Tier.changes`). Under the scheduler lock: it
 * hashes paths into the stat cache.
 */
export async function prepareObserved(
  context: SchedulerContext,
  report: RunReport,
  run: number,
): Promise<TierObservations> {
  const growth = await observedGrowth(context, report, run);
  if (growth.size === 0) return NOTHING_OBSERVED;
  const paths = new Set<RelativePath>();
  for (const { growth: grown } of growth.values()) {
    for (const path of grown) if (listedDirectory(path) === null) paths.add(path);
  }
  const snapshot = snapshotInputs(context.keys.cache, paths);
  return { growth, ...(await changedSince(snapshot, paths, context.hasher)) };
}
