import { testFileId } from "../keys/index.js";
import { shownResult, testFileOf, toKnownFailure } from "../state/index.js";
import type {
  CheckKey,
  KnownFailure,
  KnownState,
  RecordedFacts,
  RetryFact,
  RevisionNumber,
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

/**
 * The known failures of `states` with `recorded`, from the result that
 * produced each (`shownResult`, as `why` shows it): its age, load and the
 * retry asked at its key. A row at the file's current key that did not
 * produce the failure, a cached pass or a same-key replacement, gives none
 * of its facts; with no identifiable producer the failure says its age and
 * load are unknown (review 001-417 B3).
 */
export function withRecorded(
  store: Store,
  worktreeId: WorktreeId,
  states: readonly KnownState[],
  revision: RevisionNumber,
): KnownFailure[] {
  const failing = states.flatMap((state) => {
    const failure = toKnownFailure(state, revision);
    return failure === null ? [] : [{ state, failure }];
  });
  if (failing.length === 0) return [];
  const keys = new Map(
    store.testFileKeys.list(worktreeId).map((k) => [testFileId(k.testFile), k.key]),
  );
  const retries = readRetries(store);
  const loads = readRunLoads(store);
  return failing.map(({ state, failure }) => {
    if (failure.check.kind === "setup") return failure;
    const testFile = testFileOf(failure.check);
    const key = keys.get(testFileId(testFile)) ?? null;
    const results = store.results.listForCheck(failure.check, Number.MAX_SAFE_INTEGER);
    // The producer's identity, without `why`'s proof that it predates the state: an
    // inherited failure applied after its source's revision began keeps its facts.
    const row = shownResult(worktreeId, state, key, results, undefined, Number.POSITIVE_INFINITY);
    if (row === null) return { ...failure, recordedUnknown: true };
    const { provenance } = row;
    const retry = retryFactOf(retriesAt(retries, testFile, row.key));
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
