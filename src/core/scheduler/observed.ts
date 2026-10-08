import { listedDirectory, listingPath, testFileId } from "../keys/index.js";
import type { RelativePath, RunReport } from "../types/index.js";
import { checkIgnored } from "../watcher/git.js";
import type { SchedulerContext } from "./context.js";
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
}

/**
 * Prepares a tier's observations for `recordTier`, outside the lock: per
 * completed file (by `testFileId`), the paths the runner observed beyond the
 * file's closure, with what other worktrees stored meanwhile (D3, D5 as
 * amended; research observed-runtime-inputs F3, F4). A path git ignores is
 * dropped: the watcher does not track it, so it cannot key (a blind spot,
 * named in status). Every file path is hashed into the stat cache, so the
 * keys `recordTier` computes have no untracked path. Empty while policy
 * `observe.runtimeInputs` is off.
 */
export async function observedGrowth(
  context: SchedulerContext,
  report: RunReport,
): Promise<Map<string, ObservedGrowth>> {
  const out = new Map<string, ObservedGrowth>();
  const { keys } = context;
  if (!keys.observing || report.observed === undefined || report.observed.length === 0) return out;
  keys.refreshObserved(report.observed.map((o) => o.testFile.project));
  const candidates = new Set<RelativePath>();
  const seen = report.observed.map((observed) => {
    const closure = new Set(keys.index.closure(observed.testFile)?.paths ?? []);
    const fresh = [...observed.paths, ...observed.directories.map(listingPath)].filter(
      (path) => !closure.has(path),
    );
    for (const path of fresh) candidates.add(listedDirectory(path) ?? path);
    return { observed, closure, fresh };
  });
  const ignored = await checkIgnored(
    context.root,
    [...candidates].filter((p) => p !== ""),
  );
  const tracked: RelativePath[] = [];
  for (const { observed, closure, fresh } of seen) {
    const add = fresh.filter((path) => !ignored.has(listedDirectory(path) ?? path));
    const known = keys.observedOf(observed.testFile).filter((path) => !closure.has(path));
    const growth = [...new Set([...known, ...add])];
    if (growth.length === 0) continue;
    for (const path of growth) if (listedDirectory(path) === null) tracked.push(path);
    out.set(testFileId(observed.testFile), { add, growth });
  }
  await keys.track(tracked);
  return out;
}

/** A tier's observations, prepared for `recordTier` under the lock. */
export interface TierObservations {
  /** Per completed file (`testFileId`). */
  readonly growth: ReadonlyMap<string, ObservedGrowth>;
  /** Growth paths whose content on disk differs from the stat cache. */
  readonly changed: ReadonlySet<RelativePath>;
}

export const NOTHING_OBSERVED: TierObservations = { growth: new Map(), changed: new Set() };

/**
 * `observedGrowth`, and which of its file paths changed on disk since the
 * stat cache read them: the stability check of D5 for paths the tier's
 * snapshot did not hold. A listing is checked against the revisions during
 * the run (`Ledger.tierChanges`). Under the scheduler lock: it hashes paths
 * into the stat cache.
 */
export async function prepareObserved(
  context: SchedulerContext,
  report: RunReport,
): Promise<TierObservations> {
  const growth = await observedGrowth(context, report);
  if (growth.size === 0) return NOTHING_OBSERVED;
  const paths = new Set<RelativePath>();
  for (const { growth: grown } of growth.values()) {
    for (const path of grown) if (listedDirectory(path) === null) paths.add(path);
  }
  const snapshot = snapshotInputs(context.keys.cache, paths);
  return { growth, changed: await changedSince(snapshot, paths, context.hasher) };
}
