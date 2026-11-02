import type { WorktreeId } from "../../types/index.js";
import type { LintFinding, LintKnownState, LintTool } from "../../types/lint.js";
import type { LintProgress, LintReasons, LintUnknownReason } from "../../types/lint-delivery.js";
import {
  failedKey,
  failuresKey,
  lintScope,
  offKey,
  offsKey,
  readCount,
  readCursor,
  readQuiet,
} from "../pass/records.js";
import { TOOLS } from "../store/checks.js";
import type { LintMetaRepo, LintStore } from "../store/types.js";

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

/** Each tool's records scope in `worktreeId`, ESLint's first (D11). */
const scopes = (worktreeId: WorktreeId) =>
  TOOLS.map((tool): [LintTool, string] => [tool, lintScope(worktreeId, tool)]);

/** Whether any tool's pass has keyed the worktree once. */
export function anyKeyed(meta: LintMetaRepo, worktreeId: WorktreeId): boolean {
  return scopes(worktreeId).some(([, scope]) => readCursor(meta, scope) !== null);
}

/**
 * D7, D8 `linting, N of M files`: while no tool's first keying has run, or
 * a first or config keying's quiet files of a tool still wait to lint. A
 * quiet file that reads `unknown` waits for no lint, so it ends no wait.
 * `undefined` once they are linted. Counts are of checks: a file per tool.
 */
export function progressOf(
  store: LintStore,
  worktreeId: WorktreeId,
  states: readonly LintKnownState[],
): LintProgress | undefined {
  const pending = states.filter((s) => s.outcome === "pending");
  const waiting = scopes(worktreeId).some(([tool, scope]) => {
    const quiet = readQuiet(store.meta, scope);
    return pending.some((s) => s.check.tool === tool && quiet.has(s.check.path));
  });
  if (anyKeyed(store.meta, worktreeId) && !waiting) return undefined;
  return { done: states.length - pending.length, total: states.length };
}

/** D11: an off reason that says the tool is not installed (D3 step 1, D11 Discovery). */
export const isNotInstalled = (reason: string) => /^no (ESLint|oxlint) installed in /.test(reason);

/**
 * D9, D11: why lint is off or its keying failed, as each tool's pass
 * recorded it. `off` only while no tool lints: a tool lints once it keyed
 * and is not off. Then the first reason that is not "not installed" is
 * `off`, else the first; ESLint's comes first. While a tool lints, the off
 * tools' reasons are `toolsOff`, a tool not installed left out. `failed`
 * is the first tool's that failed.
 */
export function reasonsOf({ meta }: LintStore, worktreeId: WorktreeId): LintReasons {
  const offs: string[] = [];
  let lints = false;
  let failed: string | null = null;
  for (const [, scope] of scopes(worktreeId)) {
    const off = meta.get(offKey(scope));
    if (off !== null) offs.push(off);
    else if (readCursor(meta, scope) !== null) lints = true;
    failed ??= meta.get(failedKey(scope));
  }
  const shown = offs.filter((r) => !isNotInstalled(r));
  const [off, ...others] = lints ? [] : [...shown, ...offs.filter(isNotInstalled)];
  const toolsOff = lints ? shown : others.filter((r) => !isNotInstalled(r));
  return {
    ...(off === undefined ? {} : { off }),
    ...(toolsOff.length === 0 ? {} : { toolsOff }),
    ...(failed === null ? {} : { failed }),
  };
}

/** D9: how many keyings failed and how many times lint went off, over every tool's pass. */
export function noticesOf({ meta }: LintStore, worktreeId: WorktreeId) {
  let failures = 0;
  let offs = 0;
  for (const [, scope] of scopes(worktreeId)) {
    failures += readCount(meta, failuresKey(scope));
    offs += readCount(meta, offsKey(scope));
  }
  return { failures, offs };
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
