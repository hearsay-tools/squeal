import { readPolicy } from "../daemon/policy.js";
import { readAll, slot } from "../delivery/slots.js";
import { isRecord } from "../fs/index.js";
import { createInputMatcher } from "../keys/glob.js";
import { isInputList, testFileId } from "../keys/index.js";
import { slowFiles } from "../slow/classify.js";
import { slowGlobs } from "../slow/inherit.js";
import { readSlowActivity, readSlowArtifacts } from "../slow/state.js";
import type {
  CheckKey,
  KnownState,
  Policy,
  RelativePath,
  RevisionNumber,
  SlowTierActivity,
  SlowTierState,
  Store,
  TestFileKeyRecord,
  TestFileRef,
  WorktreeId,
} from "../types/index.js";
import { testFileOf } from "./derive.js";
import { artifactSources, sourcesChanged } from "./slow-sources.js";

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
 * counts as `artifactUnknown` (review wave 2, B2). The activity is read as
 * true now (`liveActivity`).
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
  const isSource = artifactSources(store, keys, view);
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
    activity: liveActivity(store, worktreeId, keys, view.isSlow),
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

/**
 * The published activity, as true now. A "running" one names only the files
 * it names that still run: a run ended since it was published (review wave
 * 2, B1), or some files of an idle tier's run did (004-35); and none when its
 * run started before the live daemon did, so a dead predecessor's (lessons
 * defect 12). A wait for the agent to pause, once no registered consumer is
 * in a turn, is a wait for the fast files pending, or for nothing (lessons
 * defect 11): the daemon publishes again only when it next looks at its slow
 * files, which fast tiers can put off for minutes. `null` when nothing is
 * true of it.
 */
function liveActivity(
  store: Store,
  worktreeId: WorktreeId,
  keys: readonly TestFileKeyRecord[],
  isSlow: (testFile: TestFileRef) => boolean,
): SlowTierActivity | null {
  const activity = readSlowActivity(store, worktreeId);
  if (activity?.kind === "waiting") {
    if (activity.for !== "idle" || consumerInTurn(store, worktreeId)) return activity;
    const fast = keys.some((row) => row.pending !== null && !isSlow(row.testFile));
    return fast ? { kind: "waiting", for: "fast" } : null;
  }
  if (activity === null) return null;
  const daemon = store.worktrees.get(worktreeId)?.daemon ?? null;
  if (daemon !== null && activity.since < daemon.startedAt) return null;
  const running = new Set(
    keys
      .filter((row) => row.pending === "running" && isSlow(row.testFile))
      .map((row) => row.testFile.path),
  );
  const [path, ...rest] = (activity.paths ?? [activity.path]).filter((p) => running.has(p));
  if (path === undefined) return null;
  const { since, lastDurationMs } = activity;
  const paths = rest.length === 0 ? {} : { paths: [path, ...rest] };
  return { kind: "running", path, ...paths, since, lastDurationMs };
}

/**
 * Whether a registered consumer of the worktree is in a turn (001 D9), from
 * the turn row `delivery/turn.ts` keeps (`turnMetaKey`), read here by its key
 * since that module reads the header. Unlike the slow tier's trigger
 * (`consumersIdle`) it has no clock, so a consumer the daemon has not yet
 * expired still counts.
 */
function consumerInTurn(store: Store, worktreeId: WorktreeId): boolean {
  const turns = readAll(store, `turn:${worktreeId}`);
  return store.consumers.list(worktreeId).some((record) => {
    const turn = turns[slot(record.consumer)];
    return isRecord(turn) && turn.turn === "in-turn";
  });
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
