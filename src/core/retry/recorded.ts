import { readFailureKeys } from "../slow/state.js";
import {
  checkIdentity,
  producingResult,
  readFailureProducers,
  readFlakyNotes,
  testFileOf,
  toKnownFailure,
} from "../state/index.js";
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

/**
 * The fact of the newest request in `records` for a failure; `undefined`
 * when none. A run asked for a file with no result is no retry of a
 * failure (011 C5, gh-36), so it is not one.
 */
export function retryFactOf(records: readonly RetryRecord[]): RetryFact | undefined {
  const newest = records.filter((r) => r.noResult !== true).at(-1);
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
 * produced each: the run the state sink named when it derived the state
 * (`readFailureProducers`) at the key it recorded for the failure, its age,
 * load and the retry asked at that key.
 * Any other row of the check, a cached pass at a new key or an identical
 * same-key failure from a later run, gives none of its facts; with no named
 * producer still stored, or one that describes another state, the failure
 * says its age and load are unknown (review 001-417 B3, task 001-420).
 * Row 011-253 (gh-103): every flaky note at a key has a pass there, and the
 * row there is a fail now, so with no note of the check at the row's key no
 * pass at these inputs is on record before the failure (`noEarlierPass`).
 * Notes are the newest per check: another key's flip hides an earlier one.
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
  const producers = readFailureProducers(store, worktreeId);
  const failureKeys = readFailureKeys(store, worktreeId);
  const retries = readRetries(store);
  const loads = readRunLoads(store);
  const notes = readFlakyNotes(store);
  return failing.map(({ state, failure }) => {
    if (failure.check.kind === "setup") return failure;
    const testFile = testFileOf(failure.check);
    const results = store.results.listForCheck(failure.check, Number.MAX_SAFE_INTEGER);
    const id = checkIdentity(state.check);
    const row = producingResult(worktreeId, state, producers.get(id), failureKeys.get(id), results);
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
      ...(notes.get(id)?.key === row.key ? {} : { noEarlierPass: true }),
    };
    return { ...failure, recorded };
  });
}
