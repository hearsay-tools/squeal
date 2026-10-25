import { closuresToReresolve, type KeyChange, testFileId } from "../keys/index.js";
import type {
  InvalidatedPath,
  ProjectName,
  RelativePath,
  Revision,
  RevisionNumber,
  RunnerClosure,
  RunnerEnvironment,
  TestFileRef,
} from "../types/index.js";
import { type SchedulerContext, tryRunner } from "./context.js";
import { demote, type EditCut, editWork, fetchEditCut, observedDirectOf } from "./edit-cut.js";
import { type Failures, failed, settleFailures } from "./failures.js";
import type { Ledger } from "./ledger.js";
import { listPaths } from "./notes.js";
import { listTestFilesOf } from "./omitted-test-files.js";
import { quietCaughtUp, quietQueued } from "./quiet.js";
import {
  applyListing,
  type ContentRekey,
  isCatchUp,
  storeClosures,
  toInvalidatedPath,
} from "./revision.js";
import { RunnerPartBound, runnerPartBound, runnerPartBoundMs } from "./runner-work-bound.js";

/**
 * What the runner said about one revision: the runner phase of its
 * refinement, fetched without the scheduler lock (review wave 4.5, S3).
 */
export interface RunnerPart {
  readonly revision: Revision;
  /** `ledger.broken` when the runner phase started: a failure is being retried. */
  readonly retrying: boolean;
  readonly failures: Failures;
  /** `null` when not read, or when the read failed (then in `failures`). */
  readonly environments: readonly RunnerEnvironment[] | null;
  /** `undefined` when not listed; `null` when the listing failed. */
  readonly listed: readonly TestFileRef[] | null | undefined;
  /** `testFileId`s of the runner's direct importers (D5 step 4). */
  readonly direct: ReadonlySet<string>;
  /** `testFileId`s stored direct marks make direct importers beside them (016 D4, `observedDirectOf`). */
  readonly observedDirect?: ReadonlySet<string>;
  /** The revision is catch-up (`ContentRekey.catchUp`, task 011-22). */
  readonly catchUp?: boolean;
  /** `ContentRekey.recent`: the files the content part left recent. */
  readonly recent?: readonly TestFileRef[];
  /**
   * The edit cut (`fetchEditCut`, task 011-25); absent when `affected`
   * gave no answer or the revision is catch-up, so every reached file stays
   * an edit's work or is catch-up as before.
   */
  readonly cut?: EditCut;
  /** Every test file whose closure was asked for, whether or not the runner answered. */
  readonly reresolved: readonly TestFileRef[];
  readonly closures: readonly RunnerClosure[];
}

/**
 * The runner phase of a revision's refinement, after `rekeyContent` stored
 * the revision. Calls the runner and reads scheduler state, but writes none,
 * so it runs without the scheduler lock and a batch is never held behind it
 * (D2: "Creating a revision never waits on the runner"). `applyRunnerPart`
 * applies the result under the lock.
 *
 * Spec 001 D5: "1. invalidates changed paths in the runner [...]; 2.
 * computes the affected test files and recomputes their keys". In detail:
 *
 * - `runner.invalidate` with every change, and as `touch` each path its
 *   batch touched with no change (task 001-159), whose referencing test
 *   files' closures are fetched again; after a recheck that recreated
 *   projects (`recheckRunner`, task 007-26), those projects instead;
 * - the environment is read again when the runner recreated a project, when
 *   an environment input changed, or while a runner failure is outstanding;
 * - the test file list is re-read after an add, a delete, a recreate, or a
 *   failed listing;
 * - closures are fetched again from the runner for files whose content key
 *   moved, the union of `closuresToReresolve` and the affected set (review:
 *   a rekey alone misses a newly created import target or snapshot), new
 *   files, every file of a recreated project, every blocked file, and the
 *   files an earlier refinement found changed while it ran (`carried`).
 *
 * Each call is bounded (`RunnerPartBound`, task 001-228): one past the
 * bound is abandoned as if it failed, with a note, and the calls after it
 * are not made, so a stalled runner holds a revision's results and every
 * wait for them no longer than the bound.
 *
 * Refinements run one at a time and in revision order, so each sees the
 * runner as every earlier one left it. They run beside the tiers in flight
 * (task 001-140), whose stability check covers what changes meanwhile.
 */
export async function fetchRunnerPart(
  context: SchedulerContext,
  ledger: Ledger,
  revision: Revision,
  content: ContentRekey,
  carried: Iterable<TestFileRef>,
  touched: readonly RelativePath[] = [],
  rechecked?: readonly ProjectName[],
): Promise<RunnerPart> {
  const { keys, runner } = context;
  const bound = new RunnerPartBound(
    context.runnerPartMs ?? runnerPartBoundMs(context.policy.runner.timeoutMs),
  );
  const changes = revision.changes;
  const paths = changes.map((c) => c.path);
  const structural = changes.some((c) => c.oldHash === null || c.newHash === null);
  const failures: Failures = new Map();
  const retrying = ledger.broken;
  const invalidations: InvalidatedPath[] = [
    ...changes.map(toInvalidatedPath),
    ...touched.map((path) => ({ path, kind: "touch" as const })),
  ];

  const invalidated =
    rechecked === undefined
      ? await tryRunner(
          context,
          `invalidate (${listPaths(invalidations.map((p) => p.path))})`,
          () => bound.call(() => runner.invalidate(invalidations)),
          (reason) => failed(failures, null, reason),
        )
      : { recreatedProjects: rechecked };
  const recreated = new Set<ProjectName>(invalidated?.recreatedProjects ?? []);
  const environments =
    recreated.size > 0 || content.environment || retrying
      ? await tryRunner(
          context,
          "environment",
          () => bound.call(() => runner.environment()),
          (reason) => failed(failures, null, reason),
        )
      : null;
  const listed =
    structural || recreated.size > 0 || ledger.listingFailed
      ? await tryRunner(context, "testFiles", () => listTestFilesOf(context, bound))
      : undefined;

  // Test files as the listing leaves them: the ones to re-resolve are among these.
  const exists = new Set(
    listed ? listed.map(testFileId) : [...ledger.files.values()].map((f) => f.id),
  );
  const reresolve = new Map<string, TestFileRef>();
  const pick = (refs: Iterable<TestFileRef>) => {
    for (const ref of refs) {
      const id = testFileId(ref);
      if (exists.has(id)) reresolve.set(id, ref);
    }
  };
  pick((listed ?? []).filter((ref) => !keys.index.closure(ref)));
  pick(
    [...ledger.files.values()]
      .filter((file) => recreated.has(file.ref.project) || file.blocked !== null)
      .map((file) => file.ref),
  );
  pick(content.rekeyed);
  pick(carried);
  // Task 001-159: a closure fetched while a touched file held other bytes may name their imports.
  pick(keys.index.reverse.referencing(touched));
  const moved = changes.filter((c) => !keys.isDeclaredInput(c.path));
  pick(closuresToReresolve(moved, keys.index.reverse, keys.isDeclaredInput));
  const affected = await tryRunner(context, `affected (${listPaths(paths)})`, () =>
    bound.call(() => runner.affected(paths)),
  );
  pick(affected?.direct ?? []);
  pick(affected?.transitive ?? []);

  const closures: RunnerClosure[] = [];
  for (const ref of reresolve.values()) {
    const closure = await tryRunner(
      context,
      `closure of ${ref.path}`,
      () => bound.call(() => runner.closure(ref)),
      (reason) => failed(failures, ref.project, reason),
    );
    if (closure !== null) closures.push(closure);
  }
  // Last, so an abandoned call for the bare sources costs no closure (011-25).
  const direct = new Set((affected?.direct ?? []).map(testFileId));
  const cut =
    affected === null || content.catchUp === true
      ? undefined
      : await fetchEditCut(context, refsOf(ledger, listed), paths, affected, bound, closures);
  return {
    revision,
    retrying,
    failures,
    environments,
    listed,
    direct,
    observedDirect: observedDirectOf(keys, paths, direct),
    ...(content.catchUp === true ? { catchUp: true } : {}),
    ...(content.recent === undefined ? {} : { recent: content.recent }),
    ...(cut === undefined ? {} : { cut }),
    reresolved: [...reresolve.values()],
    closures,
  };
}

/**
 * A quiet pass's look at what no watched file shows (`RunnerAdapter.recheck`,
 * task 007-26), bounded as a runner part's call: the projects it recreated,
 * which the caller refines as `fetchRunnerPart`'s `rechecked`. None when
 * the runner has no recheck or the call failed, which is a note and no
 * state: the next pass looks again.
 */
export async function recheckRunner(context: SchedulerContext): Promise<readonly ProjectName[]> {
  const recheck = context.runner.recheck?.bind(context.runner);
  if (recheck === undefined) return [];
  const result = await tryRunner(context, "recheck", () => runnerPartBound(context).call(recheck));
  return result?.recreatedProjects ?? [];
}

/**
 * The apply phase of a refinement, under the scheduler lock: environments,
 * the listing and the closures the runner phase fetched become keys, then
 * every file whose key may have moved is settled (D5 steps 2 to 4) and a
 * failed call blocks the files of its project (D5: "A runner call that fails
 * is a state, never a skip"). Untracked closure paths are hashed before
 * keying (review B2).
 *
 * Freshness, as the stability check does for tiers (`Tier.changes`): a
 * closure that names a path a revision changed while the runner phase ran
 * may describe the files before that change. It is applied, since it is the
 * newest the runner gave, and its test file is returned so the next
 * refinement, which that revision queued, resolves it again. No tier is
 * selected in between: selection waits for every queued refinement.
 *
 * `keyedAt` is the revision a refinement refines: the keys it moves are that
 * revision's edit (task 001-186). A runner-only refinement passes none.
 */
export async function applyRunnerPart(
  context: SchedulerContext,
  ledger: Ledger,
  part: RunnerPart,
  changedMeanwhile: ReadonlySet<RelativePath>,
  keyedAt?: RevisionNumber,
): Promise<TestFileRef[]> {
  const { keys } = context;
  const changed = new Set(part.revision.changes.map((c) => c.path));
  const touched = new Map<string, TestFileRef>();
  const touch = (refs: Iterable<TestFileRef>) => {
    for (const ref of refs) touched.set(testFileId(ref), ref);
  };
  const touchKeys = (keyChanges: readonly KeyChange[]) => touch(keyChanges.map((c) => c.testFile));

  if (part.environments !== null) touchKeys(await keys.setEnvironments(part.environments));
  // 016 D4 (O9): what other worktrees observed for module-load projects joins their closures.
  touchKeys(keys.regrowObserved());
  if (part.listed !== undefined) applyListing(context, ledger, part.listed);

  const resolved: TestFileRef[] = [];
  const stale: TestFileRef[] = [];
  for (const closure of part.closures) {
    const ref = closure.testFile;
    if (!ledger.file(ref)) continue;
    touchKeys(keys.setClosure(closure));
    resolved.push(ref);
    if ([ref.path, ...closure.paths].some((path) => changedMeanwhile.has(path))) stale.push(ref);
  }
  touchKeys(await keys.trackUntracked());
  storeClosures(context, resolved);
  touch(part.reresolved);
  // The listing and the closures count what the content part could not (review wave 5, B1).
  const catchUp =
    part.catchUp === true || (keyedAt !== undefined && isCatchUp(context, ledger, changed));
  if (catchUp && part.catchUp !== true && keyedAt !== undefined) {
    // What another revision's edit made recent stays so (`Queue.toCatchUp`).
    for (const ref of part.recent ?? []) ledger.queue.toCatchUp(ref, keyedAt);
  }
  const options = {
    direct: new Set([...part.direct, ...(part.observedDirect ?? [])]),
    ...(keyedAt === undefined ? {} : { keyedAt }),
    ...(catchUp ? { catchUp: true } : {}),
  };
  const misses = ledger.settle(touched.values(), changed, options);
  quietQueued(context, ledger, misses, part.revision.changes);
  settleFailures(ledger, part.failures, part.retrying, changed, options);
  if (!catchUp && keyedAt !== undefined && part.cut !== undefined) {
    // The rest of a small revision's reach is catch-up (011 C4 step 4 as amended for 011-25).
    const { direct, observedDirect } = part;
    const { kept, reached } = editWork(context, ledger, part.cut, changed, direct, observedDirect);
    const ids = [...reached, ...(part.recent ?? []).map(testFileId)];
    demote(ledger, ids, kept, keyedAt);
    // Its catch-up waits for quiet (011 C4 step 5 as amended 2026-10-23, row 011-153).
    quietCaughtUp(context, ledger, ids);
  }
  return stale;
}

/** The test files as the runner part's listing leaves them. */
function refsOf(
  ledger: Ledger,
  listed: readonly TestFileRef[] | null | undefined,
): readonly TestFileRef[] {
  return listed ?? [...ledger.files.values()].map((file) => file.ref);
}
