import type {
  CheckKey,
  EpochMs,
  KnownState,
  ResultRecord,
  Store,
  WorktreeId,
} from "../types/index.js";
import { worktreeMetaKey } from "../types/index.js";
import { checkIdentity } from "./derive.js";
import { sameFingerprint } from "./fingerprint.js";
import { fingerprintOf } from "./shown-result.js";

/*
 * Spec 001 D7 as amended (review 001-417 B3, round 2): a known failure's age
 * and load are those of the result that produced it. The state sink names
 * that result by its run and recorded time whenever it derives a failing
 * state from one; a row that later sits at the same key, even an identical
 * failure from the same source at the same commit, is another run. Kept in
 * `meta`, so the store schema and older readers are unchanged; a state an
 * older Squeal wrote names no producer, and its age and load read as unknown.
 *
 * An older Squeal rewriting a state leaves the reference a newer one wrote
 * (review 001-417 round 3, N2): the same outcome, fingerprint and commit can
 * then come from another origin or key. So the named row must also be the
 * state's origin, at the revision an own state was observed, and at the key
 * the sink recorded for the failure (`recordFailureKeys`), which every
 * Squeal that writes states keeps (task 001-420).
 */

/** The result a failing known state was last derived from. */
export interface FailureProducer {
  readonly runId: string;
  readonly recordedAt: EpochMs;
}

export function failureProducersMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("failureProducers", worktreeId);
}

/** The newest failing checks whose producer a worktree keeps; an older one reads as unknown. */
export const FAILURE_PRODUCERS_KEPT = 1_024;

function isProducer(value: unknown): value is FailureProducer {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.runId === "string" && typeof v.recordedAt === "number";
}

/** Each failing check's producer by `checkIdentity`, oldest first; empty when none parses. */
export function readFailureProducers(
  store: Store,
  worktreeId: WorktreeId,
): ReadonlyMap<string, FailureProducer> {
  const raw = store.meta.get(failureProducersMetaKey(worktreeId));
  if (raw === null) return new Map();
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return new Map();
    return new Map(
      Object.entries(value).filter((e): e is [string, FailureProducer] => isProducer(e[1])),
    );
  } catch {
    return new Map();
  }
}

/**
 * Records the result each check's state was just derived from: a failing
 * one names its run and time, any other forgets the check. Keeps the newest
 * `FAILURE_PRODUCERS_KEPT`. Writes only a change.
 */
export function recordFailureProducers(
  store: Store,
  worktreeId: WorktreeId,
  results: Iterable<ResultRecord>,
): void {
  const kept = new Map(readFailureProducers(store, worktreeId));
  let changed = false;
  for (const r of results) {
    const id = checkIdentity(r.check);
    if (r.outcome !== "fail") {
      changed = kept.delete(id) || changed;
      continue;
    }
    const { runId, recordedAt } = r.provenance;
    const was = kept.get(id);
    if (was?.runId === runId && was.recordedAt === recordedAt) continue;
    kept.delete(id);
    kept.set(id, { runId, recordedAt });
    changed = true;
  }
  if (!changed) return;
  const newest = [...kept].slice(-FAILURE_PRODUCERS_KEPT);
  store.meta.set(failureProducersMetaKey(worktreeId), JSON.stringify(Object.fromEntries(newest)));
}

/**
 * The stored result that produced `state` in `worktreeId`, among the
 * check's `results`: the row of the run `producer` names, still giving the
 * state's outcome, fingerprint and commit, from its origin (an own state's
 * at the revision it was observed at) and at `failureKey`, the key the
 * sink recorded for the failure. `null` when no producer or key is named,
 * or the row was replaced, pruned or describes another state.
 */
export function producingResult(
  worktreeId: WorktreeId,
  state: KnownState,
  producer: FailureProducer | undefined,
  failureKey: CheckKey | undefined,
  results: readonly ResultRecord[],
): ResultRecord | null {
  const origin = state.origin;
  if (producer === undefined || failureKey === undefined || origin === null) return null;
  return (
    results.find(
      (r) =>
        r.provenance.runId === producer.runId &&
        r.provenance.recordedAt === producer.recordedAt &&
        r.key === failureKey &&
        r.outcome === state.outcome &&
        sameFingerprint(fingerprintOf(r), state.fingerprint) &&
        r.provenance.commit === state.commit &&
        (origin.kind === "inherited"
          ? r.provenance.worktreeId === origin.worktreeId
          : r.provenance.worktreeId === worktreeId && r.provenance.revision === state.observedAt),
    ) ?? null
  );
}
