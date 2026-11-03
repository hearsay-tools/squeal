import type { KeyInputs } from "../lint/pass/keys.js";
import { lintScope, readCursor, readInputs, readProgram } from "../lint/pass/records.js";
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
  /**
   * What the keys of the check's tool were made of beside each file's own
   * bytes (row 019-21); `null` when the lint pass recorded none for its
   * cursor.
   */
  inputs(state: LintKnownState): KeyInputs | null;
}

/** What the commit says beside its blobs. */
export interface CommitSide {
  readonly committed: ReadonlyMap<RelativePath, FileHash>;
  /** The paths whose working-tree file is not the commit's (`differingPaths`). */
  readonly differing: ReadonlySet<RelativePath>;
  /**
   * True when one of `differing` is an environment input of the worktree's
   * tests (`environmentDiffers`): an installed lockfile and its patches are
   * among them, and they move the install fingerprint a lint key may hold.
   */
  readonly environment: boolean;
}

/** Whether keys made of `inputs` are the commit's: each blob is the committed one. */
function commitsInputs(inputs: KeyInputs | null, side: CommitSide): boolean {
  if (inputs === null || (inputs.installed && side.environment)) return false;
  return inputs.files.every(([path, blob]) => (side.committed.get(path) ?? null) === blob);
}

/**
 * Row 019-13 slice 2 (spec 019 D5 step 2), file-local only, with row 019-21
 * (review 0.1.396 B2): a lint check is the commit's when it is judged, not
 * stale and not `unknown`, at the committed blob of its file, and the
 * config files and their closure its tool's keys were made of are each the
 * committed blob (`LintView.inputs`); its findings then count. Inputs not
 * recorded are no evidence. A whole-program check is not determined while
 * any path differs between the commit and the working tree; with none, the
 * program is the commit's. A check pending at a file that does not differ,
 * under the commit's inputs, is still running; any other check is not
 * determined, as is a failure whose findings are not stored.
 */
export function lintCounts(view: LintView, side: CommitSide): CommitLintCounts {
  const { committed, differing } = side;
  const counts = { findings: 0, notDetermined: 0, running: 0 };
  const verdicts = new Map<KeyInputs | null, boolean>();
  const ownInputs = (state: LintKnownState) => {
    const inputs = view.inputs(state);
    let verdict = verdicts.get(inputs);
    if (verdict === undefined) {
      verdict = commitsInputs(inputs, side);
      verdicts.set(inputs, verdict);
    }
    return verdict;
  };
  for (const state of view.states) {
    const { path } = state.check;
    if (state.outcome === "pending" && !differing.has(path) && ownInputs(state)) {
      counts.running += 1;
      continue;
    }
    const judged = state.judged;
    const own =
      judged !== null &&
      !state.stale &&
      state.outcome !== "unknown" &&
      state.outcome !== "pending" &&
      judged.blob === (committed.get(path) ?? null) &&
      ownInputs(state);
    const found = own && judged.outcome === "fail" ? view.findings(state) : 0;
    if (!own || (differing.size > 0 && view.wholeProgram(state)) || found === null) {
      counts.notDetermined += 1;
      continue;
    }
    counts.findings += found;
  }
  return counts;
}

/** `read(scope)` once per scope of a state's tool. */
function perScope<T>(worktreeId: WorktreeId, read: (scope: string) => T) {
  const known = new Map<string, T>();
  return (state: LintKnownState): T => {
    const scope = lintScope(worktreeId, state.check.tool);
    if (!known.has(scope)) known.set(scope, read(scope));
    return known.get(scope) as T;
  };
}

/**
 * The `LintView` of `worktreeId` from an open lint store. A tool's inputs
 * are its record when it was written with its cursor (row 019-21): a
 * cursor an older daemon moved without one leaves no evidence.
 */
export function lintViewOf(store: LintStore, worktreeId: WorktreeId): LintView {
  const programOf = perScope(worktreeId, (scope) => new Set(readProgram(store.meta, scope).files));
  const inputsOf = perScope(worktreeId, (scope) => {
    const inputs = readInputs(store.meta, scope);
    const cursor = readCursor(store.meta, scope);
    return inputs !== null && inputs.environment === cursor?.environment ? inputs : null;
  });
  return {
    states: store.states.list(worktreeId),
    wholeProgram: (state) => programOf(state).has(state.check.path),
    findings: (state) => findingsOf(store, state)?.length ?? null,
    inputs: inputsOf,
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
  side: CommitSide,
): CommitLintCounts | undefined {
  const source = {
    policy: () => (lint.enabled ? lint : null),
    open: () => openForReading(commonDir, lint),
  };
  const read = withLint(source, ({ store }) => lintCounts(lintViewOf(store, worktreeId), side));
  return readOrNull(read) ?? undefined;
}
