import { heldForCommit, passOff, readReleased, release } from "../lint/pass/commit-entry.js";
import { holdsBlob } from "../lint/pass/keys.js";
import { heldBy } from "../lint/pass/moment.js";
import { lintScope, readCursor, readInputs, readProgram } from "../lint/pass/records.js";
import type { LintStore } from "../lint/store/types.js";
import { findingsOf, reasonsOf } from "../lint/surface/snapshot.js";
import { openForReading, readOrNull, withLint } from "../lint/surface/source.js";
import type { AbsolutePath, RelativePath, WorktreeId } from "../types/common.js";
import type { FileHash } from "../types/keys.js";
import type { LintKnownState, LintTool } from "../types/lint.js";
import type { Policy } from "../types/policy.js";
import { type CommitSide, type LintView, lintCounts, lintTally } from "./lint-tally.js";
import type { CommitLintCounts, WaitingLintCheck } from "./report.js";

/**
 * Row 017-32 (gh-170): why no tool checked a file of the commit, when none
 * did: lint is off for its reason, no tool's pass listed the files yet (or
 * the paths a commit released for it, `waits`), or the commit changed no
 * file a tool lints. `counts` unchanged otherwise.
 */
function withNotRun(
  store: LintStore,
  worktreeId: WorktreeId,
  tools: readonly LintTool[],
  counts: CommitLintCounts,
  waits = false,
): CommitLintCounts {
  if ((counts.tools?.length ?? 0) > 0) return counts;
  const { off } = reasonsOf(store, worktreeId);
  const keyed = tools.some((tool) => readCursor(store.meta, lintScope(worktreeId, tool)) !== null);
  const notRun =
    off !== undefined
      ? `off: ${off}`
      : keyed && !waits
        ? "no changed file is linted"
        : "the lint pass has not listed the changed files yet";
  return { ...counts, notRun };
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
  const programOf = perScope(worktreeId, (scope) => {
    const { files, extensions } = readProgram(store.meta, scope);
    return { files: new Set(files), extensions: new Set(extensions) };
  });
  const inputsOf = perScope(worktreeId, (scope) => {
    const inputs = readInputs(store.meta, scope);
    const cursor = readCursor(store.meta, scope);
    return inputs !== null && inputs.environment === cursor?.environment ? inputs : null;
  });
  return {
    states: store.states.list(worktreeId),
    wholeProgram: (state) => programOf(state).files.has(state.check.path),
    segmentHolds: (state, path) => holdsBlob(path, programOf(state).extensions),
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
  const read = withLint(source, ({ store }) =>
    withNotRun(store, worktreeId, lint.tools, lintCounts(lintViewOf(store, worktreeId), side)),
  );
  return readOrNull(read) ?? undefined;
}

/** A report's lint part, and the lint checks its one update waits for (row 019-22). */
export interface CommitLint {
  readonly counts: CommitLintCounts;
  readonly waiting: readonly WaitingLintCheck[];
}

/**
 * Spec 019 D5 steps 1 and 2 for lint (row 019-22), with the lint store at
 * `commonDir` open once: each tool held for a commit (`heldForCommit`)
 * releases the paths the commit changed (`side.changed`) whose
 * working-tree file is the commit's, at the committed blob, so its pass
 * lints them; then the counts. A pending check of a tool a lint group at
 * `manual` holds is never the commit's (row 019-47): not determined.
 * The update waits for the checks counted as running and for the released
 * paths: the pass may not have keyed them yet. `undefined` as
 * `readLintCounts`.
 */
export function commitLint(
  commonDir: AbsolutePath,
  policy: Policy,
  worktreeId: WorktreeId,
  side: CommitSide,
): CommitLint | undefined {
  const { lint } = policy;
  const { changed } = side;
  const source = {
    policy: () => (lint.enabled ? lint : null),
    open: () => openForReading(commonDir, lint),
  };
  const read = withLint(source, ({ store }) => {
    const released = new Map<LintTool, ReadonlyMap<RelativePath, FileHash>>();
    // A tool whose pass never keyed (none runs, as with no provider) lints nothing to wait for.
    const keyed = (tool: LintTool) => readCursor(store.meta, lintScope(worktreeId, tool)) !== null;
    for (const tool of lint.tools.filter((t) => heldForCommit(policy, t) && keyed(t))) {
      const paths = new Map<RelativePath, FileHash>();
      for (const path of changed) {
        const blob = side.committed.get(path);
        if (blob !== undefined && !side.differing.has(path)) paths.set(path, blob);
      }
      const scope = lintScope(worktreeId, tool);
      release(store.meta, scope, paths);
      released.set(tool, readReleased(store.meta, scope));
    }
    // Row 019-47 (spec 019 D1): a commit runs no check a `manual` group holds; it runs for no one.
    const manual = new Set(lint.tools.filter((tool) => heldBy(policy, tool)?.at === "manual"));
    const held = (state: LintKnownState) => {
      if (manual.has(state.check.tool)) return true;
      const own = released.get(state.check.tool);
      return (
        own !== undefined && own.get(state.check.path) !== side.committed.get(state.check.path)
      );
    };
    const { counts, running } = lintTally(lintViewOf(store, worktreeId), side, held);
    const waiting = new Map<string, WaitingLintCheck>();
    const wait = (tool: LintTool, path: RelativePath, blob: FileHash | undefined) => {
      if (blob !== undefined) waiting.set(`${tool}\0${path}`, { tool, path, blob });
    };
    for (const state of running) {
      wait(state.check.tool, state.check.path, side.committed.get(state.check.path));
    }
    for (const [tool, paths] of released) {
      for (const path of changed) if (paths.has(path)) wait(tool, path, paths.get(path));
    }
    return {
      counts: withNotRun(store, worktreeId, lint.tools, counts, waiting.size > 0),
      waiting: [...waiting.values()],
    };
  });
  return readOrNull(read) ?? undefined;
}

/**
 * Row 019-22 (D5 step 3): whether the lint checks a report waits for
 * (`waiting`, made at `revision`) all ended. A tool's checks end with the
 * tool, once lint or the tool is off, its pass is off or never keyed; else
 * once its pass keyed `revision`, each check that is not pending at its blob, whose
 * file is no longer that blob (`blobOf`, an edit came between), or that a
 * tool held for a commit holds unreleased. `true` when the store cannot be
 * read: nothing would end the wait.
 */
export function lintWaitEnded(
  commonDir: AbsolutePath,
  policy: Policy,
  worktreeId: WorktreeId,
  waiting: readonly WaitingLintCheck[],
  revision: number,
  blobOf: (path: RelativePath) => FileHash | null | undefined,
): boolean {
  const { lint } = policy;
  if (waiting.length === 0 || !lint.enabled) return true;
  const source = { policy: () => lint, open: () => openForReading(commonDir, lint) };
  const read = withLint(source, ({ store }) =>
    lint.tools.every((tool) => {
      const own = waiting.filter((w) => w.tool === tool);
      if (own.length === 0) return true;
      const scope = lintScope(worktreeId, tool);
      const cursor = readCursor(store.meta, scope);
      if (cursor === null || passOff(store.meta, scope)) return true;
      if (cursor.revision < revision) return false;
      const paths = own.map((w) => w.path);
      const pending = new Set(
        store.states
          .list(worktreeId, { paths, tool })
          .filter((s) => s.outcome === "pending")
          .map((s) => s.check.path),
      );
      const released = heldForCommit(policy, tool) ? readReleased(store.meta, scope) : null;
      return own.every(
        (w) =>
          !pending.has(w.path) ||
          blobOf(w.path) !== w.blob ||
          (released !== null && released.get(w.path) !== w.blob),
      );
    }),
  );
  return readOrNull(read) ?? true;
}
