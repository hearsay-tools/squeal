import { acceptedAt, currentChecks } from "../../../../src/core/scheduler/accept.js";
import type { SchedulerContext } from "../../../../src/core/scheduler/context.js";
import type {
  CheckId,
  CheckKey,
  ResultRecord,
  TestFileRef,
} from "../../../../src/core/types/index.js";

/*
 * The accept rule (task 011-37 section 5, row 011-40): `acceptedAt` over
 * the store, the formats read as one through the key index, and the checks
 * `currentChecks` retires when the hits become the file's results.
 */

export interface Accepted {
  readonly hits: readonly ResultRecord[];
  readonly mayWait: boolean;
  /** The checks of `current` the hits lack, retired when they become the file's results. */
  readonly retired: readonly CheckId[];
}

/** `context`'s lookup of `key` for `testFile`, whose current results hold `current`. */
export function acceptRule(
  context: SchedulerContext,
  _testFile: TestFileRef,
  key: CheckKey,
  current: readonly CheckId[],
): Accepted {
  const { store, worktreeId, now } = context;
  const { hits, mayWait } = acceptedAt(store, worktreeId, key, now, {
    keys: (k) => context.keys.index.keysReadAsOne(k),
    read: new Map(),
  });
  return { hits, mayWait, retired: hits.length > 0 ? currentChecks(current, hits).retired : [] };
}
