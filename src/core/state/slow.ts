import { readPolicy } from "../daemon/policy.js";
import { createInputMatcher } from "../keys/glob.js";
import { isInputList, testFileId } from "../keys/index.js";
import { slowFiles } from "../slow/classify.js";
import { slowGlobs } from "../slow/inherit.js";
import { readSlowActivity } from "../slow/state.js";
import type {
  KnownState,
  Policy,
  RelativePath,
  RevisionNumber,
  SlowTierState,
  Store,
  TestFileKeyRecord,
  TestFileRef,
  WorktreeId,
} from "../types/index.js";
import { testFileOf } from "./derive.js";

/*
 * Spec 004 D8: the slow tier as headers, status and Stop read it from the
 * store and the worktree's policy, with no daemon.
 */

/** A policy's slow files and what they are declared to run against. */
export interface SlowPolicyView {
  readonly isSlow: (testFile: TestFileRef) => boolean;
  /** The declared input globs of the slow test file at `path`, sorted (D5). */
  artifactFor(path: RelativePath): readonly string[];
}

/** The slow view of `policy`; `null` when it declares no slow file (D1). */
export function slowPolicyView(policy: Policy): SlowPolicyView | null {
  if (slowGlobs(policy, policy.nodeTest).length === 0) return null;
  const { inputs } = policy;
  const rules = isInputList(inputs)
    ? [{ applies: () => true, globs: inputs }]
    : Object.entries(inputs).map(([testGlob, globs]) => ({
        applies: createInputMatcher([testGlob]),
        globs,
      }));
  return {
    isSlow: slowFiles(policy, policy.nodeTest),
    artifactFor: (path) =>
      [...new Set(rules.filter((r) => r.applies(path)).flatMap((r) => r.globs))].sort(),
  };
}

/**
 * The slow view of the policy at the worktree's root, from its `worktrees`
 * row; `null` without a row or a slow file declared.
 */
export function worktreeSlowView(store: Store, worktreeId: WorktreeId): SlowPolicyView | null {
  const root = store.worktrees.get(worktreeId)?.root;
  return root === undefined ? null : slowPolicyView(readPolicy(root));
}

type SlowClass = "current" | "pending" | "notRun";

/**
 * Each listed slow test file by class: `pending` when a check is pending or
 * the file is queued or running without checks, `current` when every check
 * is current, `notRun` otherwise.
 */
export function classifySlowFiles(
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
  isSlow: (testFile: TestFileRef) => boolean,
): Map<string, { readonly ref: TestFileRef; readonly class: SlowClass }> {
  const checks = new Map<string, KnownState[]>();
  for (const state of states) {
    const ref = testFileOf(state.check);
    if (!isSlow(ref)) continue;
    const id = testFileId(ref);
    checks.set(id, [...(checks.get(id) ?? []), state]);
  }
  const files = new Map<string, { ref: TestFileRef; class: SlowClass }>();
  for (const row of keys) {
    if (!isSlow(row.testFile)) continue;
    const id = testFileId(row.testFile);
    const own = checks.get(id) ?? [];
    const cls: SlowClass =
      own.length === 0
        ? row.key !== null && row.pending !== null
          ? "pending"
          : "notRun"
        : own.some((s) => s.validity === "pending")
          ? "pending"
          : own.every((s) => s.validity === "current")
            ? "current"
            : "notRun";
    files.set(id, { ref: row.testFile, class: cls });
  }
  return files;
}

/** The slow-tier line's state (D8) at `revision`, read in the caller's transaction. */
export function readSlowTier(
  store: Store,
  worktreeId: WorktreeId,
  revision: RevisionNumber,
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
  view: SlowPolicyView,
): SlowTierState {
  const files = classifySlowFiles(states, keys, view.isSlow);
  const counts = { current: 0, pending: 0, notRun: 0 };
  const artifact = new Set<string>();
  for (const { ref, class: cls } of files.values()) {
    counts[cls]++;
    for (const glob of view.artifactFor(ref.path)) artifact.add(glob);
  }
  let currentAt: RevisionNumber | null = null;
  for (const state of states) {
    if (state.validity !== "current" || state.observedAt === null) continue;
    if (files.get(testFileId(testFileOf(state.check)))?.class !== "current") continue;
    currentAt = currentAt === null ? state.observedAt : Math.min(currentAt, state.observedAt);
  }
  const globs = [...artifact].sort();
  return {
    testFiles: files.size,
    ...counts,
    currentAt,
    artifact: globs,
    sourcesChangedSince:
      currentAt !== null && sourcesChanged(store, worktreeId, currentAt, revision, globs),
    activity: readSlowActivity(store, worktreeId),
  };
}

/** Whether a revision after `since` up to `revision` changed a path no artifact glob matches. */
function sourcesChanged(
  store: Store,
  worktreeId: WorktreeId,
  since: RevisionNumber,
  revision: RevisionNumber,
  artifact: readonly string[],
): boolean {
  if (since >= revision) return false;
  const isArtifact = createInputMatcher(artifact);
  return store.revisions
    .range(worktreeId, since, revision)
    .some((r) => r.changes.some((change) => !isArtifact(change.path)));
}

/** The listed slow test files not current: pending or not run (`stop.requireSlowSuite`, D7). */
export function slowFilesNotCurrent(
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
  isSlow: (testFile: TestFileRef) => boolean,
): readonly TestFileRef[] {
  return [...classifySlowFiles(states, keys, isSlow).values()]
    .filter((file) => file.class !== "current")
    .map((file) => file.ref);
}
