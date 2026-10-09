import { type Hasher, StatCache, sameStat } from "../hash/index.js";
import { type BatchDiff, diffCandidates, statCandidates } from "../revision/index.js";
import type { RelativePath, RunReport } from "../types/index.js";

/**
 * A copy of the stat cache entries of `paths`: the inputs a tier's keys were
 * computed from. Taken when the tier is selected, because reconciliation may
 * move the live cache on while the tier runs.
 */
export function snapshotInputs(cache: StatCache, paths: Iterable<RelativePath>): StatCache {
  const snapshot = new StatCache();
  for (const path of paths) {
    const record = cache.get(path);
    if (record) snapshot.set(record, { racy: cache.isRacy(path) });
    else if (cache.hashOf(path) === null) snapshot.delete(path);
  }
  return snapshot;
}

/** What moved on disk since a snapshot of the stat cache. */
export interface Moved {
  /** Content differs. */
  readonly changed: Set<RelativePath>;
  /** Written since and ended as it was (`touchedUnchanged`). */
  readonly touched: Set<RelativePath>;
}

/**
 * Paths among `paths` whose content on disk differs from `snapshot`, and
 * those written since whose bytes ended as they were.
 *
 * Spec 001 D5: "After each tier, every closure path of the tier's test files
 * is re-stat'ed. If any hash differs from the inputs of the key the tier ran
 * under, that file's results are discarded as unreliable and the file is
 * re-queued." `diffCandidates` against the snapshot, whose updates are never
 * applied anywhere. A touch is the completion barrier of review wave-13e B2
 * (task 001-168): the watcher may report it only after the tier is recorded.
 */
export async function changedSince(
  snapshot: StatCache,
  paths: Iterable<RelativePath>,
  hasher: Hasher,
): Promise<Moved> {
  const candidates = await statCandidates(paths, hasher);
  const diff = await diffCandidates(candidates, snapshot, hasher);
  return {
    changed: new Set(diff.changes.map((change) => change.path)),
    touched: new Set(touchedUnchanged(diff, snapshot)),
  };
}

/**
 * Paths of `diff` hashed because their stat moved, with the hash they had
 * in `cache` (task 001-159). Read before `diff`'s updates reach `cache`. A
 * racy entry re-hashed on an equal stat was not written since, so it is not
 * among them.
 */
export function touchedUnchanged(
  diff: Pick<BatchDiff, "changes" | "updates">,
  cache: StatCache,
): RelativePath[] {
  const changed = new Set(diff.changes.map((change) => change.path));
  const touched: RelativePath[] = [];
  for (const update of diff.updates) {
    if (update.kind !== "set" || changed.has(update.record.path)) continue;
    const cached = cache.get(update.record.path);
    if (cached !== undefined && !sameStat(cached, update.record)) touched.push(cached.path);
  }
  return touched;
}

/**
 * Review wave-13e B2 (task 001-168): `report` with no file completed, since
 * `touched` were written while it was in flight and ended as they were. A
 * cache may have served the run their other bytes, and the watcher's batch
 * may reach the runner only after the tier is recorded, so the barrier
 * withholds the run as a touch the runner heard does: its files are
 * `unknown` with a reason naming the paths.
 */
export function withheldForTouch(report: RunReport, touched: readonly RelativePath[]): RunReport {
  if (touched.length === 0) return report;
  const reason = `squeal: ${touched.join(", ")} was written while this run was in flight and ended as it was; the run may have executed bytes no check key names (task 001-168)`;
  const { fileDurations, observed, ...rest } = report;
  return {
    ...rest,
    completedFiles: [],
    results: [],
    fileErrors: [],
    failure: report.failure === null ? reason : `${report.failure}\n${reason}`,
  };
}
