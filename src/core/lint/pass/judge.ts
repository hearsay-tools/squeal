import type {
  CheckKey,
  EpochMs,
  FileHash,
  RelativePath,
  RevisionNumber,
  WorktreeId,
} from "../../types/index.js";
import type {
  LintChange,
  LintCheckId,
  LintFinding,
  LintKnownState,
  LintOutcome,
  LintResult,
  LintTransition,
} from "../../types/lint.js";
import { lintFingerprint } from "../fingerprint.js";
import type { LintResultRepo } from "../store/types.js";
import { type LintCause, lintTransition } from "../transition.js";

export function lintCheck(path: RelativePath): LintCheckId {
  return { kind: "lint", path, tool: "eslint" };
}

/** Where a state is judged: its worktree, the revision and the time. */
export interface JudgeAt {
  readonly worktreeId: WorktreeId;
  readonly revision: RevisionNumber;
  readonly now: EpochMs;
}

/** One file's next state and, when one is recorded, its transition. */
export interface Judged {
  readonly state: LintKnownState;
  readonly transition: LintTransition | null;
}

/** A state with `outcome`, the judged result kept, as `pending` and `unknown` keep it. */
function moved(
  prior: LintKnownState | null,
  path: RelativePath,
  at: JudgeAt,
  outcome: LintOutcome,
  reason: string | null,
): LintKnownState {
  return {
    worktreeId: at.worktreeId,
    check: lintCheck(path),
    outcome,
    judged: prior?.judged ?? null,
    stale: false,
    reason,
    changedAt: prior?.outcome === outcome ? prior.changedAt : at.revision,
  };
}

/** D7: a miss waits to be linted; its last judged result stays for the next transition. */
export function pendingState(prior: LintKnownState | null, path: RelativePath, at: JudgeAt) {
  return moved(prior, path, at, "pending", null);
}

/** D9: the provider gave no result for the file; why is kept for status. */
export function unknownState(
  prior: LintKnownState | null,
  path: RelativePath,
  at: JudgeAt,
  reason: string,
) {
  return moved(prior, path, at, "unknown", reason);
}

/** A linted file's result, shared by every worktree at its key (D6). */
export function resultOf(
  path: RelativePath,
  key: CheckKey,
  findings: readonly LintFinding[],
  toolVersion: string,
  now: EpochMs,
): LintResult {
  return {
    check: lintCheck(path),
    key,
    outcome: findings.length === 0 ? "pass" : "fail",
    findings,
    fingerprint: lintFingerprint(findings),
    toolVersion,
    lintedAt: now,
  };
}

/**
 * D2: the state a result gives a file, linted or found by key, and the
 * transition from the result it was last judged on (017-03's notes).
 */
export function judgeResult(
  results: Pick<LintResultRepo, "get">,
  prior: LintKnownState | null,
  result: LintResult,
  blob: FileHash,
  at: JudgeAt & { readonly cause: LintCause },
): Judged {
  const state: LintKnownState = {
    worktreeId: at.worktreeId,
    check: result.check,
    outcome: result.outcome,
    judged: {
      key: result.key,
      outcome: result.outcome,
      fingerprint: result.fingerprint,
      blob,
      revision: at.revision,
    },
    stale: false,
    reason: null,
    changedAt: prior?.outcome === result.outcome ? prior.changedAt : at.revision,
  };
  const change = changeOf(results, prior, result.findings, at.cause);
  if (change === null) return { state, transition: null };
  return {
    state,
    transition: {
      ...change,
      worktreeId: at.worktreeId,
      check: result.check,
      revision: at.revision,
      at: at.now,
    },
  };
}

/** D2: a file deleted or excluded while `fail` is resolved, once, with its findings. */
export function judgeRemoved(
  results: Pick<LintResultRepo, "get">,
  prior: LintKnownState,
  at: JudgeAt,
): LintTransition | null {
  const change = changeOf(results, prior, null, "edit");
  if (change === null) return null;
  return {
    ...change,
    worktreeId: at.worktreeId,
    check: prior.check,
    revision: at.revision,
    at: at.now,
  };
}

/**
 * D2's transition from what `prior` was last judged on. Those findings are
 * read at the judged key; a judged `fail` whose result is gone gives only
 * what its fingerprint proves, with no finding named.
 */
function changeOf(
  results: Pick<LintResultRepo, "get">,
  prior: LintKnownState | null,
  after: readonly LintFinding[] | null,
  cause: LintCause,
): LintChange | null {
  const judged = prior?.judged ?? null;
  if (prior === null || judged === null) return lintTransition(null, after, cause);
  if (judged.outcome === "pass") return lintTransition([], after, cause);
  const stored = results.get(prior.check, judged.key);
  if (stored !== null) return lintTransition(stored.findings, after, cause);
  const now = after === null ? null : lintFingerprint(after);
  if (cause === "config" || now === judged.fingerprint) return null;
  const kind = after === null ? "removed" : now === null ? "fail-to-pass" : "fail-changed";
  return { kind, added: after ?? [], removed: [] };
}
