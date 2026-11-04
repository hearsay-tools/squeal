import type { WaitingTestFile } from "../commit/report.js";
import type { RelativePath, TestFileRef } from "../types/index.js";
import type { CommitAsk } from "./commit-asks.js";
import { NOTHING_CHANGED, type SchedulerContext } from "./context.js";
import { classify } from "./files.js";
import type { Ledger } from "./ledger.js";
import { groupView } from "./slow.js";

/*
 * Spec 019 D5 step 1 (row 019-22): on a move to a commit Squeal has not
 * reported, each configured test group at `commit` runs its files whose
 * closure holds a path the commit changed, or every one of its files when
 * a changed path is an environment input. Only a file whose key is the
 * commit's (no closure path or environment input differs from the working
 * tree) and that is not current: one left unstaged has no result for the
 * commit to take, and Squeal runs nothing on the committed tree (open
 * question 4).
 */

/** What the commit moment needs from the scheduler's lanes. */
export interface CommitLanes {
  /** The lane of group `group` runs `asks` at their keys (`SlowTier.asks`). */
  ask(group: string, asks: readonly CommitAsk[]): void;
  /** A commit asked for `ref` at its key now. */
  asked(ref: TestFileRef): boolean;
}

/** Per scheduler, its lanes (`attachCommitLanes`); a scheduler without lanes asks nothing. */
const lanesOf = new WeakMap<SchedulerContext, CommitLanes>();

/** The scheduler's start hands its lanes to the commit moment. */
export function attachCommitLanes(context: SchedulerContext, lanes: CommitLanes): void {
  lanesOf.set(context, lanes);
}

/** What the commit says beside its blobs, for one ask. */
export interface CommitChange {
  /** `git diff --name-only <old HEAD> <new HEAD>` (`changedPaths`). */
  readonly changed: ReadonlySet<RelativePath>;
  /** The paths whose working-tree file is not the commit's (`differingPaths`). */
  readonly differing: ReadonlySet<RelativePath>;
  /** One of `differing` is an environment input. */
  readonly environment: boolean;
}

/** The configured test groups at `commit`, by name. */
function commitGroups(context: SchedulerContext): Set<string> {
  const { groups } = groupView(context.policy);
  return new Set(
    groups
      .filter((g) => g.index !== null && g.at === "commit" && g.select.kind === "tests")
      .map((g) => g.name),
  );
}

/**
 * Asks each `commit` group's lane for the files the commit re-keyed (above).
 * A file not queued (a `lookup-only` miss, an `unknown` file) is queued,
 * as `queueGroup` does; the lane runs a file only at its asked key.
 */
export function askCommitGroups(
  context: SchedulerContext,
  ledger: Ledger,
  change: CommitChange,
): void {
  const lanes = lanesOf.get(context);
  const groups = commitGroups(context);
  if (lanes === undefined || groups.size === 0 || change.environment) return;
  const { keys } = context;
  const everyFile = [...change.changed].some((path) => keys.isEnvironmentInput(path));
  const { of } = groupView(context.policy);
  const asks = new Map<string, CommitAsk[]>();
  const misses: TestFileRef[] = [];
  for (const file of ledger.files.values()) {
    const group = of(file.ref).name;
    const { key } = file;
    if (!groups.has(group) || key === null || file.blocked !== null) continue;
    if (classify(file) === "current") continue;
    const closure = keys.index.closure(file.ref)?.paths;
    if (closure === undefined || closure.some((path) => change.differing.has(path))) continue;
    if (!everyFile && !closure.some((path) => change.changed.has(path))) continue;
    asks.set(group, [...(asks.get(group) ?? []), { ref: file.ref, key }]);
    file.unknownKey = null;
    if (file.phase === null) misses.push(file.ref);
  }
  if (asks.size === 0) return;
  ledger.settle(misses, NOTHING_CHANGED);
  ledger.commit();
  for (const [group, own] of asks) lanes.ask(group, own);
}

/**
 * A queued file of a `commit` group that no commit asked for at its key:
 * it runs for no one until a commit or `squeal run <group>` (row 019-22).
 */
export function heldTestFile(context: SchedulerContext): (ref: TestFileRef) => boolean {
  const lanes = lanesOf.get(context);
  const groups = commitGroups(context);
  if (groups.size === 0) return () => false;
  const { of } = groupView(context.policy);
  return (ref) => groups.has(of(ref).name) && lanes?.asked(ref) !== true;
}

/**
 * Row 019-22 (D5 step 3): whether the test files a report waits for all
 * ended. One still runs while it is pending at its key and runs for
 * someone (`heldTestFile`), or while a run of it at its key is in flight.
 */
export function testWaitEnded(
  context: SchedulerContext,
  ledger: Ledger,
  waiting: readonly WaitingTestFile[],
): boolean {
  const held = heldTestFile(context);
  return waiting.every(({ project, path, key }) => {
    const file = ledger.file({ project, path });
    if (file === undefined) return true;
    if (file.runningKey === key) return false;
    if (file.key !== key || file.phase === null) return true;
    return held(file.ref);
  });
}
