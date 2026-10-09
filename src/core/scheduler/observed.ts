import { listedDirectory, listingPath, testFileId } from "../keys/index.js";
import type { RelativePath, RunReport, TestFileRef } from "../types/index.js";
import { checkIgnored } from "../watcher/git.js";
import type { SchedulerContext } from "./context.js";
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
   * began: no evidence from before the run holds them, so no key with them
   * can certify this run's result (review wave 12d, B1; task 001-134).
   */
  readonly firstSeen: readonly RelativePath[];
}

/**
 * Prepares a tier's observations for `recordTier`, outside the lock: per
 * completed file (by `testFileId`), the paths the runner observed beyond the
 * file's closure, with what other worktrees stored meanwhile (D3, D5 as
 * amended; research observed-runtime-inputs F3, F4), a recursive listing as
 * the listing of each directory below it, and a path read through a directory
 * link with its target (`linkTargets`). A path git ignores is
 * dropped: the watcher does not track it, so it cannot key (a blind spot,
 * named in status). Every file path is hashed into the stat cache, so the
 * keys `recordTier` computes have no untracked path; a path hashed only now,
 * after its read and after run `run` (`WorktreeKeys.beginRun`) began, is
 * `firstSeen`. Empty while policy `observe.runtimeInputs`
 * is off.
 */
export async function observedGrowth(
  context: SchedulerContext,
  report: RunReport,
  run: number,
): Promise<Map<string, ObservedGrowth>> {
  const out = new Map<string, ObservedGrowth>();
  const { keys } = context;
  if (!keys.observing || report.observed === undefined || report.observed.length === 0) return out;
  keys.refreshObserved(report.observed.map((o) => o.testFile.project));
  const candidates = new Set<RelativePath>();
  const seen = [];
  for (const observed of report.observed) {
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
    const add = fresh.filter((path) => !ignored.has(listedDirectory(path) ?? path));
    const known = keys.observedOf(observed.testFile).filter((path) => !closure.has(path));
    const growth = [...new Set([...known, ...add])];
    if (growth.length === 0) continue;
    for (const path of growth) if (listedDirectory(path) === null) tracked.push(path);
    grown.push({ testFile: observed.testFile, add, growth });
  }
  await keys.track(tracked);
  for (const { testFile, add, growth } of grown) {
    const firstSeen = growth.filter(
      (path) => listedDirectory(path) === null && keys.firstHashedDuringRun(path, run),
    );
    out.set(testFileId(testFile), { add, growth, firstSeen });
  }
  return out;
}

/** A tier's observations, prepared for `recordTier` under the lock. */
export interface TierObservations {
  /** Per completed file (`testFileId`). */
  readonly growth: ReadonlyMap<string, ObservedGrowth>;
  /** Growth paths whose content on disk differs from the stat cache. */
  readonly changed: ReadonlySet<RelativePath>;
  /** Growth paths written since the stat cache read them, their bytes as they were (task 001-168). */
  readonly touched: ReadonlySet<RelativePath>;
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
