import type {
  CheckId,
  KnownState,
  PendingPhase,
  ResultOrigin,
  ResultRecord,
  RevisionNumber,
  TestFileKeyRecord,
  TestFileRef,
  Validity,
  WorktreeId,
} from "../types/index.js";
import { describeFailure } from "./fingerprint.js";

/** One string per check identity, for maps keyed by check. */
export function checkIdentity(check: CheckId): string {
  const name = check.kind === "test" ? check.fullName : "";
  return `${check.kind}\0${check.project}\0${check.testPath}\0${name}`;
}

export function testFileIdentity(file: TestFileRef): string {
  return `${file.project}\0${file.path}`;
}

export function testFileOf(check: CheckId): TestFileRef {
  return { project: check.project, path: check.testPath };
}

interface Classified {
  readonly validity: Validity;
  readonly pendingPhase: PendingPhase | null;
}

/**
 * Spec 001 D5: "A stored result is **current** for a check in a worktree at a
 * revision when its key equals the key computed for that check at that
 * revision. Otherwise the check is **stale** [...] or **unknown** [...].
 * **Pending** means a run that will produce a result for the current key is
 * queued or running." A current result stays current while a forced re-run
 * is pending.
 */
export function classify(
  outcome: KnownState["outcome"],
  resultKey: string | null,
  key: TestFileKeyRecord | undefined,
): Classified {
  if (key !== undefined && resultKey !== null && resultKey === key.key) {
    return { validity: "current", pendingPhase: null };
  }
  if (key?.pending) return { validity: "pending", pendingPhase: key.pending };
  return { validity: outcome === "unknown" ? "unknown" : "stale", pendingPhase: null };
}

function originOf(worktreeId: WorktreeId, result: ResultRecord): ResultOrigin {
  const p = result.provenance;
  return p.worktreeId === worktreeId
    ? { kind: "own" }
    : { kind: "inherited", worktreeId: p.worktreeId, commit: p.commit };
}

function sameOrigin(a: ResultOrigin | null, b: ResultOrigin): boolean {
  if (a === null || a.kind !== b.kind) return false;
  return (
    a.kind === "own" ||
    (b.kind === "inherited" && a.worktreeId === b.worktreeId && a.commit === b.commit)
  );
}

/**
 * The known state a result gives a check. `observedAt` is the result's own
 * revision when this worktree produced it; an inherited result is observed
 * at the revision it was first applied at, kept while the same result stays.
 */
export function stateFromResult(
  worktreeId: WorktreeId,
  revision: RevisionNumber,
  result: ResultRecord,
  key: TestFileKeyRecord | undefined,
  previous: KnownState | null,
): KnownState {
  const origin = originOf(worktreeId, result);
  const failed = result.outcome === "fail";
  const described = failed && (result.fingerprint === null || result.summary === null);
  const fallback = described ? describeFailure(result.errors, result.location) : null;
  const fingerprint = failed ? (result.fingerprint ?? fallback?.fingerprint ?? null) : null;
  const unchanged =
    previous !== null &&
    previous.outcome === result.outcome &&
    previous.fingerprint === fingerprint &&
    previous.commit === result.provenance.commit &&
    sameOrigin(previous.origin, origin);
  const observedAt =
    origin.kind === "own"
      ? result.provenance.revision
      : unchanged && previous.observedAt !== null
        ? previous.observedAt
        : revision;
  return {
    worktreeId,
    check: result.check,
    outcome: result.outcome,
    ...classify(result.outcome, result.key, key),
    observedAt,
    commit: result.provenance.commit,
    origin,
    durationMs: result.durationMs,
    location: failed ? (result.errors[0]?.location ?? result.location) : result.location,
    summary: failed ? (result.summary ?? fallback?.summary ?? null) : null,
    fingerprint,
  };
}

/** A known state with no result under the current key: same outcome, validity re-classified. */
export function stateWithoutResult(
  previous: KnownState,
  key: TestFileKeyRecord | undefined,
): KnownState {
  return { ...previous, ...classify(previous.outcome, null, key) };
}

/** Spec 001 D12: a check of a crashed or timed-out tier "becomes `unknown` at this revision". */
export function unknownState(
  previous: KnownState,
  revision: RevisionNumber,
  key: TestFileKeyRecord | undefined,
  reason: string,
): KnownState {
  return {
    ...previous,
    outcome: "unknown",
    ...classify("unknown", null, key),
    observedAt: revision,
    durationMs: null,
    summary: reason,
    fingerprint: null,
  };
}

export function sameState(a: KnownState, b: KnownState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
