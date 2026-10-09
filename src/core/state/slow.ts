import { readPolicy } from "../daemon/policy.js";
import { createInputMatcher } from "../keys/glob.js";
import { isInputList, testFileId } from "../keys/index.js";
import { slowFiles } from "../slow/classify.js";
import { inheritsAcrossWorktrees, slowGlobs } from "../slow/inherit.js";
import { readSlowActivity, readSlowArtifacts } from "../slow/state.js";
import type {
  CheckKey,
  KnownState,
  Policy,
  RelativePath,
  Revision,
  RevisionNumber,
  SlowTierActivity,
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
  /** Every glob that marks slow files (`slowGlobs`). */
  readonly slowGlobs: readonly string[];
  /** The declared input globs of the slow test file at `path`, sorted (D5). */
  artifactFor(path: RelativePath): readonly string[];
}

/** The slow view of `policy`; `null` when it declares no slow file (D1). */
export function slowPolicyView(policy: Policy): SlowPolicyView | null {
  const globs = slowGlobs(policy, policy.nodeTest);
  if (globs.length === 0) return null;
  const { inputs } = policy;
  const rules = isInputList(inputs)
    ? [{ applies: () => true, globs: inputs }]
    : Object.entries(inputs).map(([testGlob, globs]) => ({
        applies: createInputMatcher([testGlob]),
        globs,
      }));
  return {
    isSlow: slowFiles(policy, policy.nodeTest),
    slowGlobs: globs,
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

/**
 * The slow-tier line's state (D8) at `revision`, read in the caller's
 * transaction. A current claim names the artifact the current results' runs
 * were declared to test, from the record their worktree kept with the key
 * (`readSlowArtifacts`), never today's policy; a current file with none
 * counts as `artifactUnknown` (review wave 2, B2). A "running" activity
 * stands only while the file it names is running (B1).
 */
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
  for (const { class: cls } of files.values()) counts[cls]++;
  let currentAt: RevisionNumber | null = null;
  let currentUpTo: RevisionNumber | null = null;
  const ranFrom = new Map<string, WorktreeId>();
  for (const state of states) {
    if (state.validity !== "current" || state.observedAt === null) continue;
    const id = testFileId(testFileOf(state.check));
    if (files.get(id)?.class !== "current") continue;
    currentAt = currentAt === null ? state.observedAt : Math.min(currentAt, state.observedAt);
    currentUpTo = Math.max(currentUpTo ?? state.observedAt, state.observedAt);
    const origin = state.origin?.kind === "inherited" ? state.origin.worktreeId : worktreeId;
    ranFrom.set(id, origin);
  }
  const artifactOf = recordedArtifacts(store);
  const artifact = new Set<string>();
  // Only to tell later source changes from artifact ones; never named as what a run tested.
  const declaredToday = new Set<string>();
  let artifactUnknown = 0;
  for (const row of keys) {
    const from = ranFrom.get(testFileId(row.testFile));
    if (from === undefined) continue;
    const recorded = row.key === null ? undefined : artifactOf(from, row.key);
    if (recorded === undefined) artifactUnknown++;
    for (const glob of recorded ?? []) artifact.add(glob);
    for (const glob of recorded === undefined ? view.artifactFor(row.testFile.path) : []) {
      declaredToday.add(glob);
    }
  }
  const globs = [...artifact].sort();
  const testFiles = new Set(keys.map((row) => row.testFile.path));
  const isSource = (path: RelativePath) =>
    inheritsAcrossWorktrees({ path, slow: true }, [path], testFiles, view.slowGlobs);
  return {
    testFiles: files.size,
    ...counts,
    currentAt,
    ...(currentUpTo !== null && currentUpTo !== currentAt ? { currentUpTo } : {}),
    artifact: globs,
    ...(artifactUnknown > 0 ? { artifactUnknown } : {}),
    sourcesChangedSince:
      currentAt !== null &&
      sourcesChanged(
        store,
        worktreeId,
        currentAt,
        revision,
        [...globs, ...declaredToday],
        isSource,
      ),
    activity: liveActivity(readSlowActivity(store, worktreeId), keys, view.isSlow),
  };
}

/** The declared artifact of a slow run of `key` in `worktreeId`, reading each worktree's record once. */
function recordedArtifacts(store: Store) {
  const records = new Map<WorktreeId, ReadonlyMap<CheckKey, readonly string[]>>();
  return (from: WorktreeId, key: CheckKey): readonly string[] | undefined => {
    let byKey = records.get(from);
    if (byKey === undefined) {
      byKey = readSlowArtifacts(store, from);
      records.set(from, byKey);
    }
    return byKey.get(key);
  };
}

/** `activity`, unless it names a file as running that is not: a run ended since it was published. */
function liveActivity(
  activity: SlowTierActivity | null,
  keys: readonly TestFileKeyRecord[],
  isSlow: (testFile: TestFileRef) => boolean,
): SlowTierActivity | null {
  if (activity?.kind !== "running") return activity;
  const running = keys.some(
    (row) =>
      row.testFile.path === activity.path && row.pending === "running" && isSlow(row.testFile),
  );
  return running ? activity : null;
}

/**
 * Whether a revision after `since` up to `revision` changed a source the
 * artifact could be built from: a path no artifact glob matches that
 * `isSource` admits, so neither a test file nor a slow directory's fixture
 * (as D6 tells an artifact from them; lessons defect 8a). A worktree's first
 * listing is not a change (lessons defect 8d): the change feed's start pass
 * finds every file beneath a linked directory new, as git lists the link and
 * never its files. Only that pass, an `interval` revision 1 of adds, is left
 * out; an add a watch batch or a daemon's start found counts (review wave 4 B4).
 */
function sourcesChanged(
  store: Store,
  worktreeId: WorktreeId,
  since: RevisionNumber,
  revision: RevisionNumber,
  artifact: readonly string[],
  isSource: (path: RelativePath) => boolean,
): boolean {
  if (since >= revision) return false;
  const isArtifact = createInputMatcher(artifact);
  return store.revisions
    .range(worktreeId, since, revision)
    .filter((r) => !isFirstListing(r))
    .some((r) => r.changes.some((change) => !isArtifact(change.path) && isSource(change.path)));
}

/** The change feed's start pass at a fresh worktree: revision 1, `interval`, adds only. */
function isFirstListing(revision: Revision): boolean {
  return (
    revision.number === 1 &&
    revision.trigger === "interval" &&
    revision.changes.every((change) => change.oldHash === null)
  );
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
