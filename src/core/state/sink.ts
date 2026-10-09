import { testFileId } from "../keys/index.js";
import { recordFailureKeys } from "../slow/state.js";
import type {
  CheckKey,
  EpochMs,
  KnownState,
  ResultRecord,
  RevisionNumber,
  StateSink,
  Store,
  TestFileKeyRecord,
  Transition,
  WorktreeId,
} from "../types/index.js";
import { recordBaselineFindings } from "./baseline.js";
import {
  checkIdentity,
  sameState,
  stateFromResult,
  stateWithoutResult,
  testFileKeyOf,
  unknownState,
} from "./derive.js";
import { failureKeysOnce, heldFailure } from "./inherited.js";
import { transitionKind } from "./transitions.js";

export interface StateSinkOptions {
  /** Clock for transition times. Default `Date.now`. */
  readonly now?: () => EpochMs;
}

/** Each result's check with its key when it failed, else `null` (`recordFailureKeys`). */
function failureKeys(results: Iterable<ResultRecord>): ReadonlyMap<string, CheckKey | null> {
  const keys = new Map<string, CheckKey | null>();
  for (const r of results) keys.set(checkIdentity(r.check), r.outcome === "fail" ? r.key : null);
  return keys;
}

/**
 * The store-backed `StateSink` (spec 001 D6). Every method runs in one store
 * transaction: known states, transitions and baseline findings are written
 * together or not at all, with the key each failing state's result was
 * stored under (spec 004 D8, review wave 2.5 B1).
 */
export function createStateSink(store: Store, options: StateSinkOptions = {}): StateSink {
  const now = options.now ?? Date.now;

  /** Previous states, keys by test file, and a writer that records transitions. */
  function begin(worktreeId: WorktreeId) {
    const previous = new Map(
      store.knownStates.list(worktreeId).map((s) => [checkIdentity(s.check), s]),
    );
    const keys = new Map(
      store.testFileKeys.list(worktreeId).map((k) => [testFileId(k.testFile), k]),
    );
    const keyOf = (state: Pick<KnownState, "check">): TestFileKeyRecord | undefined =>
      keys.get(testFileKeyOf(state.check));
    const prior = (state: Pick<KnownState, "check">) =>
      previous.get(checkIdentity(state.check)) ?? null;

    const commit = (
      revision: RevisionNumber,
      next: readonly KnownState[],
      checkpointId: string | null,
    ): readonly Transition[] => {
      const at = now();
      const changed: KnownState[] = [];
      const recorded: Transition[] = [];
      for (const state of next) {
        const before = prior(state);
        if (before !== null && sameState(before, state)) continue;
        changed.push(state);
        const kind = transitionKind(before, state);
        if (kind === null) continue;
        recorded.push({
          worktreeId,
          check: state.check,
          kind,
          from: before?.outcome ?? null,
          to: state.outcome,
          fromFingerprint: before?.fingerprint ?? null,
          toFingerprint: state.fingerprint,
          revision,
          at,
        });
      }
      store.knownStates.upsertMany(changed);
      store.transitions.append(recorded);
      recordBaselineFindings(store, worktreeId, checkpointId, recorded);
      return recorded;
    };

    return { previous, keys, keyOf, prior, commit };
  }

  return {
    applyResults: (worktreeId, revision, results, provenance) =>
      store.transaction(() => {
        const { keyOf, prior, commit } = begin(worktreeId);
        const next = results.map((r) =>
          stateFromResult(worktreeId, revision, r, keyOf(r), prior(r)),
        );
        recordFailureKeys(store, worktreeId, failureKeys(results));
        return commit(revision, next, provenance.checkpointId);
      }),

    markUnknown: (worktreeId, revision, testFiles, reason) =>
      store.transaction(() => {
        const { previous, keyOf, commit } = begin(worktreeId);
        const files = new Set(testFiles.map(testFileId));
        const next = [...previous.values()]
          .filter((s) => files.has(testFileKeyOf(s.check)))
          .map((s) => unknownState(s, revision, keyOf(s), reason));
        return commit(revision, next, null);
      }),

    refresh: (worktreeId, revision, provenance, testFiles) =>
      store.transaction(() => {
        const { previous, keys, keyOf, prior, commit } = begin(worktreeId);
        const only = testFiles === undefined ? null : new Set(testFiles.map(testFileId));
        const included = (file: string) => only === null || only.has(file);
        const at = now();
        const next = new Map<string, KnownState>();
        const hits: ResultRecord[] = [];
        const confirmed = failureKeysOnce(store, worktreeId);
        for (const [file, key] of keys) {
          if (!included(file)) continue;
          const results = store.results.byKey(key.key, at);
          // Another worktree's unconfirmed fail holds the whole file until it runs here (task 001-170).
          if (heldFailure(store, worktreeId, results, confirmed) !== undefined) continue;
          for (const r of results) {
            hits.push(r);
            next.set(
              checkIdentity(r.check),
              stateFromResult(worktreeId, revision, r, key, prior(r)),
            );
          }
        }
        recordFailureKeys(store, worktreeId, failureKeys(hits));
        for (const [id, state] of previous) {
          const key = keyOf(state);
          if (key === undefined || next.has(id)) continue;
          if (included(testFileId(key.testFile))) next.set(id, stateWithoutResult(state, key));
        }
        return commit(revision, [...next.values()], provenance.checkpointId);
      }),

    // A told failure stays in the view: delivery reports it once as no longer reported (D6).
    retire: (worktreeId, checks) =>
      store.transaction(() => {
        store.knownStates.removeMany(worktreeId, checks);
        const retired = new Set(checks.map(checkIdentity));
        for (const { consumer } of store.consumers.list(worktreeId)) {
          const silent = store.views
            .list(consumer)
            .filter((v) => v.outcome !== "fail" && retired.has(checkIdentity(v.check)))
            .map((v) => v.check);
          store.views.removeMany(consumer, silent);
        }
      }),
  };
}
