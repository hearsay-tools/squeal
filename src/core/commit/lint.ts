import { lintScope, readProgram } from "../lint/pass/records.js";
import type { LintStore } from "../lint/store/types.js";
import { findingsOf } from "../lint/surface/snapshot.js";
import { openForReading, readOrNull, withLint } from "../lint/surface/source.js";
import type { AbsolutePath, FileHash, Policy, RelativePath, WorktreeId } from "../types/index.js";
import type { LintKnownState } from "../types/lint.js";
import type { CommitLintCounts } from "./report.js";

/** What the lint store says of one worktree's lint checks, for one commit. */
export interface LintView {
  readonly states: readonly LintKnownState[];
  /** True for a whole-program check: its key reads every program file (017 D5). */
  wholeProgram(state: LintKnownState): boolean;
  /** The findings of a check's judged result; `null` when that result is not stored. */
  findings(state: LintKnownState): number | null;
}

/**
 * Row 019-13 slice 2 (spec 019 D5 step 2), file-local only: a lint check is
 * the commit's when it is judged, not stale and not `unknown`, at the
 * committed blob of its file; its findings then count. A whole-program
 * check is not determined while any path differs between the commit and
 * the working tree (`differing`); with none, the program is the commit's.
 * A check pending at a file that does not differ is still running; any
 * other check is not determined, as is a failure whose findings are not
 * stored. A lint config file left unstaged is not seen: the lint store
 * does not record the config files a key read.
 */
export function lintCounts(
  view: LintView,
  committed: ReadonlyMap<RelativePath, FileHash>,
  differing: ReadonlySet<RelativePath>,
): CommitLintCounts {
  const counts = { findings: 0, notDetermined: 0, running: 0 };
  for (const state of view.states) {
    const { path } = state.check;
    if (state.outcome === "pending" && !differing.has(path)) {
      counts.running += 1;
      continue;
    }
    const judged = state.judged;
    const own =
      judged !== null &&
      !state.stale &&
      state.outcome !== "unknown" &&
      state.outcome !== "pending" &&
      judged.blob === (committed.get(path) ?? null);
    const found = own && judged.outcome === "fail" ? view.findings(state) : 0;
    if (!own || (differing.size > 0 && view.wholeProgram(state)) || found === null) {
      counts.notDetermined += 1;
      continue;
    }
    counts.findings += found;
  }
  return counts;
}

/** The `LintView` of `worktreeId` from an open lint store. */
export function lintViewOf(store: LintStore, worktreeId: WorktreeId): LintView {
  const whole = new Map<string, ReadonlySet<RelativePath>>();
  const programOf = (state: LintKnownState) => {
    const scope = lintScope(worktreeId, state.check.tool);
    let files = whole.get(scope);
    if (files === undefined) {
      files = new Set(readProgram(store.meta, scope).files);
      whole.set(scope, files);
    }
    return files;
  };
  return {
    states: store.states.list(worktreeId),
    wholeProgram: (state) => programOf(state).has(state.check.path),
    findings: (state) => findingsOf(store, state)?.length ?? null,
  };
}

/**
 * The lint counts of a commit from the lint store at `commonDir`, opened
 * for reading; `undefined` while `lint.enabled` is off or the store cannot
 * be read, so the report has no lint part.
 */
export function readLintCounts(
  commonDir: AbsolutePath,
  lint: Policy["lint"],
  worktreeId: WorktreeId,
  committed: ReadonlyMap<RelativePath, FileHash>,
  differing: ReadonlySet<RelativePath>,
): CommitLintCounts | undefined {
  const source = {
    policy: () => (lint.enabled ? lint : null),
    open: () => openForReading(commonDir, lint),
  };
  const read = withLint(source, ({ store }) =>
    lintCounts(lintViewOf(store, worktreeId), committed, differing),
  );
  return readOrNull(read) ?? undefined;
}
