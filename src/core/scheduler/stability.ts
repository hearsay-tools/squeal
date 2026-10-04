import { type Hasher, StatCache } from "../hash/index.js";
import { diffCandidates, statCandidates } from "../revision/index.js";
import type { RelativePath } from "../types/index.js";

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

/**
 * Paths among `paths` whose content on disk differs from `snapshot`.
 *
 * Spec 001 D5: "After each tier, every closure path of the tier's test files
 * is re-stat'ed. If any hash differs from the inputs of the key the tier ran
 * under, that file's results are discarded as unreliable and the file is
 * re-queued." `diffCandidates` against the snapshot, whose updates are never
 * applied anywhere.
 */
export async function changedSince(
  snapshot: StatCache,
  paths: Iterable<RelativePath>,
  hasher: Hasher,
): Promise<Set<RelativePath>> {
  const candidates = await statCandidates(paths, hasher);
  const { changes } = await diffCandidates(candidates, snapshot, hasher);
  return new Set(changes.map((change) => change.path));
}
