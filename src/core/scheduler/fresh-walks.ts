import { testFileId } from "../keys/reverse-index.js";
import type { FetchedPart } from "../store/import-edges.js";
import type { RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { RunnerClosure, RunnerEnvironment } from "../types/runner.js";

/*
 * Row 015-119 (review 0.1.415-r3, B2-R3): which walks of a runner part may
 * be bound to a key. A walk is stored under the key the apply phase sets,
 * which a revision reconciled while the runner phase ran may have moved;
 * the walk then describes the files before that revision. The scheduler
 * already judges such a closure changed meanwhile (`applyRunnerPart`) and
 * carries its test file to the next refinement, whose fresh walk is the
 * one stored. An environment read while one of its files changed follows
 * the same rule: the revision that changed it reads the environment again.
 */

/** Whether a revision reconciled meanwhile changed a file `environment` was read or walked from. */
function changedUnder(
  environment: RunnerEnvironment,
  changedMeanwhile: ReadonlySet<RelativePath>,
): boolean {
  const read = [...environment.files, ...(environment.imports ?? []).map((file) => file.path)];
  return read.some((path) => changedMeanwhile.has(path));
}

/**
 * The walks of `closures` and `environments` the scheduler judged fresh:
 * the closures of `resolved` test files not in `stale`, and the
 * environments no revision changed under while they were read.
 */
export function freshWalks(
  closures: readonly RunnerClosure[],
  environments: readonly RunnerEnvironment[] | null,
  resolved: readonly TestFileRef[],
  stale: readonly TestFileRef[],
  changedMeanwhile: ReadonlySet<RelativePath>,
): FetchedPart {
  const keep = new Set(resolved.map(testFileId));
  for (const ref of stale) keep.delete(testFileId(ref));
  return {
    closures: closures.filter((closure) => keep.has(testFileId(closure.testFile))),
    environments:
      environments?.filter((environment) => !changedUnder(environment, changedMeanwhile)) ?? null,
  };
}
