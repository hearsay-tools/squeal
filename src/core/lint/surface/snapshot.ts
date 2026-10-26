import type { WorktreeId } from "../../types/index.js";
import type { LintFinding, LintKnownState } from "../../types/lint.js";
import type { LintProgress, LintReasons, LintUnknownReason } from "../../types/lint-delivery.js";
import { failedKey, offKey, readCursor, readQuiet } from "../pass/records.js";
import type { LintStore } from "../store/types.js";

/*
 * Spec 017 D8, D9: the counts and reasons every surface reads from the
 * lint store, as the pass left them. A `stale` file keeps its outcome, so
 * it is counted as stale and never as failing or passing.
 */

/** A file failing at its current key. */
export const isCurrentFail = (s: LintKnownState) => s.outcome === "fail" && !s.stale;

/** The worktree's files by state; the groups never hold one file twice. */
export interface LintCounts {
  readonly files: number;
  readonly failing: number;
  readonly pending: number;
  readonly stale: number;
  readonly unknown: number;
  readonly reasons: readonly LintUnknownReason[];
}

export function countsOf(states: readonly LintKnownState[]): LintCounts {
  const reasons = new Map<string, number>();
  for (const s of states) {
    if (s.outcome !== "unknown") continue;
    const reason = s.reason ?? "no reason recorded";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  return {
    files: states.length,
    failing: states.filter(isCurrentFail).length,
    pending: states.filter((s) => s.outcome === "pending").length,
    stale: states.filter((s) => s.stale).length,
    unknown: states.filter((s) => s.outcome === "unknown").length,
    reasons: [...reasons]
      .map(([reason, files]) => ({ reason, files }))
      .sort((a, b) => b.files - a.files || a.reason.localeCompare(b.reason)),
  };
}

/**
 * D7, D8 `linting, N of M files`: while the worktree's first keying has not
 * run, or a first or config keying's quiet files still wait to lint. A
 * quiet file that reads `unknown` waits for no lint, so it ends no wait.
 * `undefined` once they are linted.
 */
export function progressOf(
  store: LintStore,
  worktreeId: WorktreeId,
  states: readonly LintKnownState[],
): LintProgress | undefined {
  const pending = new Set(states.filter((s) => s.outcome === "pending").map((s) => s.check.path));
  const keyed = readCursor(store.meta, worktreeId) !== null;
  const waiting = [...readQuiet(store.meta, worktreeId)].some((p) => pending.has(p));
  if (keyed && !waiting) return undefined;
  return { done: states.length - pending.size, total: states.length };
}

/** D9: why lint is off or its keying failed, as the pass recorded it. */
export function reasonsOf({ meta }: LintStore, worktreeId: WorktreeId): LintReasons {
  const off = meta.get(offKey(worktreeId));
  const failed = meta.get(failedKey(worktreeId));
  return { ...(off === null ? {} : { off }), ...(failed === null ? {} : { failed }) };
}

/**
 * The findings of the result `state` was last judged on, in ESLint's
 * order: none for a `pass` or before the first; `null` when that result is
 * no longer stored, so no surface says "0 findings" of a failing file.
 */
export function findingsOf(store: LintStore, state: LintKnownState): readonly LintFinding[] | null {
  const judged = state.judged;
  if (judged === null || judged.outcome === "pass") return [];
  return store.results.get(state.check, judged.key)?.findings ?? null;
}
