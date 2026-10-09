import { createStateSink, recordFlips } from "../state/index.js";
import type { ResultRecord } from "../types/index.js";
import type { SchedulerContext } from "./context.js";

/**
 * Stores one run's results of a test file (`results.putMany`, one row per
 * check and key, replacing what the key held) and, spec 001 D6 as amended
 * (task 001-170), records a flaky note for each check whose outcome flipped
 * under the key. A `fail` replaced by a `pass` heals every other worktree
 * whose current key for the file is that key: their states are refreshed
 * from the row, so a failure they held or confirmed becomes the current pass
 * and is delivered to them as `FAIL -> PASS`. A pass replaced by a fail
 * changes no other worktree: its fail stands there only once it runs there.
 * Returns what the key held before (task 001-171, `holdsNewFailure`).
 */
export function storeResults(
  context: SchedulerContext,
  records: readonly ResultRecord[],
): readonly ResultRecord[] {
  const [first] = records;
  if (first === undefined) return [];
  const { store, worktreeId, now } = context;
  return store.transaction(() => {
    // `usedAt` 0 never advances last-used: reading what is replaced is not a lookup hit (D8).
    const prior = store.results.byKey(first.key, 0);
    store.results.putMany(records);
    const flips = recordFlips(store, prior, records, now());
    if (!flips.some((note) => note.to === "pass")) return prior;
    const { project, testPath } = first.check;
    // The scheduler's sink is this worktree's; another worktree's states go through the store's own.
    const sink = createStateSink(store, { now });
    for (const row of store.testFileKeys.withKey(first.key)) {
      if (row.worktreeId === worktreeId) continue;
      if (row.testFile.project !== project || row.testFile.path !== testPath) continue;
      const revision = store.revisions.latest(row.worktreeId)?.number ?? row.revision;
      sink.refresh(row.worktreeId, revision, { checkpointId: null }, [row.testFile]);
    }
    return prior;
  });
}
