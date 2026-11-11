import { GIT_ENTRY, listedDirectory, listingPath } from "../keys/observed.js";
import { testFileId } from "../keys/reverse-index.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { ObservedInputs, RunReport } from "../types/runner.js";
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
 * completed file (by `testFileId`), the inputs the runner observed beyond the
 * file's closure (`inputsOfReads`), with what other worktrees stored
 * meanwhile (D3, D5 as amended). A path git ignores is kept, and watched as
 * an extra file, unless it is the run's own scratch. Every file path
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
  // Row 016-24: the names a listed ignored directory holds now are this run's own.
  for (const observed of reported) keys.listedByRun(observed.testFile, observed.directories);
  const reads = reported.map((observed) => ({
    closure: new Set(keys.index.closure(observed.testFile)?.paths ?? []),
    observed,
  }));
  const below = (directory: RelativePath) => keys.listingsBelow(directory);
  const { inputs, ignored } = await inputsOfReads(context.root, reads, below);
  const tracked: RelativePath[] = [];
  const grown: { testFile: TestFileRef; add: RelativePath[]; growth: RelativePath[] }[] = [];
  for (const [at, { observed, closure }] of reads.entries()) {
    const add = inputs[at] ?? [];
    const kept = new Set([...closure, ...add]);
    keys.markDirect(
      observed.testFile,
      (observed.direct ?? []).filter((path) => kept.has(path)),
    );
    keys.markModules(
      observed.testFile,
      (observed.modules ?? []).filter((path) => kept.has(path)),
    );
    const known = keys.observedOf(observed.testFile).filter((path) => !closure.has(path));
    const growth = keys.effectiveObserved(observed.testFile, [...new Set([...known, ...add])]);
    // Module marks persist through writeSeen even when effective inputs do not grow.
    if (growth.length === 0 && add.length === 0) continue;
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
    const firstSeen = [...hashed, ...ignoredListings(growth, ignored)];
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

/** One completed file's run-time read, and its closure, whose paths are no input of the read. */
export interface ObservedRead {
  readonly closure: ReadonlySet<RelativePath>;
  readonly observed: Omit<ObservedInputs, "testFile">;
}

/** The listing paths a recursive listing of `directory` reads (`Listings.below`). */
export type ListingsBelow = (directory: RelativePath) => readonly RelativePath[];

/**
 * The inputs of each of `reads` beyond its closure, as the record keys them
 * (D3, D5 as amended; research observed-runtime-inputs F3, F4): each path it
 * read, with its target when it was read through a directory link
 * (`linkTargets`, task 001-148); each listing, a recursive listing as the
 * listing of each directory below it (`below`; B5, task 001-134); and none
 * of the run's own scratch, a git-ignored path below a directory it wrote,
 * created or removed (`scratchOf`, 016 D4). The daemon's record and the
 * gate's `--parts` (`inputsOfReadsHere` in `ci/inputs.ts`; spec 020 D13.2,
 * row 020-20) both key by it. Reads links and asks git once for all of `reads`; changes
 * nothing. `ignored`: the inputs git ignores, a listing by its directory.
 */
export async function inputsOfReads(
  root: AbsolutePath,
  reads: readonly ObservedRead[],
  below: ListingsBelow,
): Promise<{
  readonly inputs: readonly RelativePath[][];
  readonly ignored: ReadonlySet<RelativePath>;
}> {
  const candidates = new Set<RelativePath>();
  const fresh: RelativePath[][] = [];
  for (const { closure, observed } of reads) {
    const listed = new Set(observed.directories.map(listingPath));
    for (const directory of observed.recursive ?? []) {
      for (const path of below(directory)) listed.add(path);
    }
    const read = observed.paths.filter((path) => !closure.has(path));
    const targets = await linkTargets(root, read);
    const paths = [...new Set([...read, ...targets, ...listed])].filter(
      (path) => !closure.has(path),
    );
    for (const path of paths) candidates.add(listedDirectory(path) ?? path);
    fresh.push(paths);
  }
  const ignored = await checkIgnored(
    root,
    [...candidates].filter((p) => p !== ""),
  );
  const inputs = reads.map(({ observed }, at) => {
    const scratch = scratchOf(observed.written ?? [], ignored);
    return (fresh[at] ?? []).filter((path) => !scratch(listedDirectory(path) ?? path));
  });
  return { inputs, ignored };
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
