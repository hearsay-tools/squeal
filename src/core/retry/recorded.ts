import { testFileId } from "../keys/index.js";
import { checkIdentity, testFileOf } from "../state/index.js";
import type {
  CheckKey,
  KnownFailure,
  RecordedFacts,
  ResultRecord,
  RetryFact,
  Store,
  TestFileRef,
  WorktreeId,
} from "../types/index.js";
import { readRunLoads } from "./load.js";
import { type RetryRecord, readRetries, retriesAt } from "./records.js";

/*
 * Spec 001 D6 as amended (001-368): "An inherited failure states the facts
 * Squeal has, never a judgement: the worktree and revision it was recorded
 * at, the load average per CPU when it ran, and whether a retry was asked
 * for at that key and how it ended."
 */

/** The fact of the newest request in `records`; `undefined` when none. */
export function retryFactOf(records: readonly RetryRecord[]): RetryFact | undefined {
  const newest = records.at(-1);
  if (newest === undefined) return undefined;
  return { reason: newest.reason, outcome: newest.end?.outcome ?? "pending" };
}

/**
 * The retry asked for `testFile` at `key` that run `runId` passed, the run
 * whose result recovered the check; `undefined` when that run was no retry's
 * (review 001-398, S2: an earlier retry's pass is not this recovery's).
 */
export function passedRetry(
  store: Store,
  testFile: TestFileRef,
  key: CheckKey,
  runId: string,
): RetryFact | undefined {
  return retryFactOf(
    retriesAt(readRetries(store), testFile, key).filter(
      (r) => r.end?.outcome === "passed" && r.end.runId === runId,
    ),
  );
}

/** `failures` with `recorded`, read from the rows that stand for them at the worktree's keys. */
export function withRecorded(
  store: Store,
  worktreeId: WorktreeId,
  failures: readonly KnownFailure[],
): KnownFailure[] {
  if (failures.length === 0) return [];
  const keys = new Map(
    store.testFileKeys.list(worktreeId).map((k) => [testFileId(k.testFile), k.key]),
  );
  const rows = new Map<CheckKey, readonly ResultRecord[]>();
  const retries = readRetries(store);
  const loads = readRunLoads(store);
  return failures.map((failure) => {
    if (failure.check.kind === "setup") return failure;
    const testFile = testFileOf(failure.check);
    const key = keys.get(testFileId(testFile));
    if (key === undefined || key === null) return failure;
    if (!rows.has(key)) rows.set(key, store.results.byKey(key));
    const identity = checkIdentity(failure.check);
    const row = rows.get(key)?.find((r) => checkIdentity(r.check) === identity);
    if (row === undefined) return failure;
    const { provenance } = row;
    const retry = retryFactOf(retriesAt(retries, testFile, key));
    const recorded: RecordedFacts = {
      worktreeId: provenance.worktreeId,
      worktreeRoot: store.worktrees.get(provenance.worktreeId)?.root ?? null,
      revision: provenance.revision,
      recordedAt: provenance.recordedAt,
      loadPerCpu: loads.get(provenance.runId) ?? null,
      ...(retry === undefined ? {} : { retry }),
    };
    return { ...failure, recorded };
  });
}
