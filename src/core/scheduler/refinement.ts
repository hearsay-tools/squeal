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
import { type Failures, failed, settleFailures } from "./failures.js";
import type { Ledger } from "./ledger.js";
import { listPaths } from "./notes.js";
import { applyListing, type ContentRekey, storeClosures, toInvalidatedPath } from "./revision.js";
import { RunnerPartBound, runnerPartBoundMs } from "./runner-work-bound.js";

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
 *   files' closures are fetched again;
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

  const invalidated = await tryRunner(
    context,
    `invalidate (${listPaths(invalidations.map((p) => p.path))})`,
    () => bound.call(() => runner.invalidate(invalidations)),
    (reason) => failed(failures, null, reason),
  );
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
      ? await tryRunner(context, "testFiles", () => bound.call(() => runner.testFiles()))
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
  return {
    revision,
    retrying,
    failures,
    environments,
    listed,
    direct: new Set((affected?.direct ?? []).map(testFileId)),
    reresolved: [...reresolve.values()],
    closures,
  };
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
  ledger.settle(touched.values(), changed, {
    direct: part.direct,
    ...(keyedAt === undefined ? {} : { keyedAt }),
  });
  settleFailures(ledger, part.failures, part.retrying, changed);
  return stale;
}
