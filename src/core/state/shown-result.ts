import type {
  CheckKey,
  EpochMs,
  KnownState,
  ResultRecord,
  RevisionNumber,
  Store,
  WorktreeId,
} from "../types/index.js";
import { describeFailure } from "./fingerprint.js";

/**
 * The stored result the known state shows, from all of the check's
 * `results` (review wave-13i B4). A current state was derived from the row
 * at its test file's current `key`: that row, if it is still the result the
 * state names. Otherwise the only row the state names: same outcome,
 * fingerprint and commit, from the producing worktree, and for an own result at the
 * revision it was observed at. `null` when no stored row is identifiably it:
 * replaced, pruned, or several keys fit. Never a nearby run. With no known
 * state, the held failure `why` shows.
 *
 * An inherited state names a row only when the row provably predates it
 * (review wave-13j B4): recorded no later than `observedSince`, the time the
 * revision the state was observed at was created. The state was applied at
 * or after that time from the row then at the key, and a row replaced later
 * is recorded later. A same-key replacement by a later run, at any commit or
 * revision, names none. An own state is re-derived from each of its own runs.
 * `why` shows this row, and a known failure's age and load are its (review
 * 001-417 B3).
 */
export function shownResult(
  worktreeId: WorktreeId,
  knownState: KnownState | null,
  key: CheckKey | null,
  results: readonly ResultRecord[],
  held: ResultRecord | undefined,
  observedSince: EpochMs | null,
): ResultRecord | null {
  if (knownState === null) return held ?? null;
  const origin = knownState.origin;
  if (origin === null) return null;
  const names = (r: ResultRecord) =>
    r.outcome === knownState.outcome &&
    fingerprintOf(r) === knownState.fingerprint &&
    r.provenance.commit === knownState.commit &&
    (origin.kind === "inherited"
      ? r.provenance.worktreeId === origin.worktreeId &&
        observedSince !== null &&
        r.provenance.recordedAt <= observedSince
      : r.provenance.worktreeId === worktreeId && r.provenance.revision === knownState.observedAt);
  if (knownState.validity === "current" && key !== null) {
    const atKey = results.find((r) => r.key === key);
    return atKey !== undefined && names(atKey) ? atKey : null;
  }
  const named = results.filter(names);
  return named.length === 1 ? (named[0] ?? null) : null;
}

/**
 * The earliest time a state observed at `revision` could have been applied
 * (review wave-13j B4): the revision's creation, or for revision 0, the
 * bootstrap before any change, the worktree's first registration. `null`
 * when neither is stored.
 */
export function observedSince(
  store: Store,
  worktreeId: WorktreeId,
  revision: RevisionNumber | null,
): EpochMs | null {
  if (revision === null) return null;
  if (revision === 0) return store.worktrees.get(worktreeId)?.registeredAt ?? null;
  return store.revisions.get(worktreeId, revision)?.createdAt ?? null;
}

/** A result's fingerprint as its known state took it (`stateFromResult`): described when not stored. */
function fingerprintOf(result: ResultRecord): string | null {
  if (result.outcome !== "fail") return null;
  return result.fingerprint ?? describeFailure(result.errors, result.location).fingerprint;
}
