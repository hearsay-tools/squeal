import { heldForCommit, passOff, readReleased, release } from "../lint/pass/commit-entry.js";
import type { KeyInputs } from "../lint/pass/keys.js";
import { lintScope, readCursor, readInputs, readProgram } from "../lint/pass/records.js";
import type { LintStore } from "../lint/store/types.js";
import { findingsOf } from "../lint/surface/snapshot.js";
import { openForReading, readOrNull, withLint } from "../lint/surface/source.js";
import type { AbsolutePath, FileHash, Policy, RelativePath, WorktreeId } from "../types/index.js";
import type { LintKnownState, LintTool } from "../types/lint.js";
import type { CommitLintCounts, WaitingLintCheck } from "./report.js";

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
  return lintTally(view, side, () => false).counts;
}

/** The counts of one report's lint checks, and those it counts as running. */
export interface LintTally {
  readonly counts: CommitLintCounts;
  readonly running: readonly LintKnownState[];
}

/**
 * `lintCounts`, and the checks counted as running. A pending check that
 * waits for a commit or a request none gave it (`held`, row 019-22) runs
 * for no one: it is not determined.
 */
export function lintTally(
  view: LintView,
  side: CommitSide,
  held: (state: LintKnownState) => boolean,
): LintTally {
  const { committed, differing } = side;
  const counts = { findings: 0, notDetermined: 0, running: 0 };
  const running: LintKnownState[] = [];
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
    if (state.outcome === "pending" && !differing.has(path) && ownInputs(state) && !held(state)) {
      counts.running += 1;
      running.push(state);
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
  return { counts, running };
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

/** A report's lint part, and the lint checks its one update waits for (row 019-22). */
export interface CommitLint {
  readonly counts: CommitLintCounts;
  readonly waiting: readonly WaitingLintCheck[];
}

/**
 * Spec 019 D5 steps 1 and 2 for lint (row 019-22), with the lint store at
 * `commonDir` open once: each tool held for a commit (`heldForCommit`)
 * releases the paths the commit changed whose working-tree file is the
 * commit's, at the committed blob, so its pass lints them; then the counts.
 * The update waits for the checks counted as running and for the released
 * paths: the pass may not have keyed them yet. `undefined` as
 * `readLintCounts`.
 */
export function commitLint(
  commonDir: AbsolutePath,
  policy: Policy,
  worktreeId: WorktreeId,
  side: CommitSide,
  changed: ReadonlySet<RelativePath>,
): CommitLint | undefined {
  const { lint } = policy;
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
    const held = (state: LintKnownState) => {
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
    return { counts, waiting: [...waiting.values()] };
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
