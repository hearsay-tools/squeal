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
 * The scheduler's freshness decision for a runner part's walks. `stale`:
 * the `resolved` test files whose closure names a path a revision changed
 * meanwhile; the scheduler carries them to its next refinement, which
 * resolves them again. `walks`: what may be bound to a key now, the other
 * resolved files' closures and the environments no revision changed under
 * while they were read.
 */
export function bindWalks(
  part: {
    readonly closures: readonly RunnerClosure[];
    readonly environments: readonly RunnerEnvironment[] | null;
  },
  resolved: readonly TestFileRef[],
  changedMeanwhile: ReadonlySet<RelativePath>,
): { readonly stale: TestFileRef[]; readonly walks: FetchedPart } {
  const keep = new Set(resolved.map(testFileId));
  const stale: TestFileRef[] = [];
  for (const closure of part.closures) {
    const ref = closure.testFile;
    if (!keep.has(testFileId(ref))) continue;
    if ([ref.path, ...closure.paths].some((path) => changedMeanwhile.has(path))) {
      stale.push(ref);
      keep.delete(testFileId(ref));
    }
  }
  return {
    stale,
    walks: {
      closures: part.closures.filter((closure) => keep.has(testFileId(closure.testFile))),
      environments:
        part.environments?.filter((env) => !changedUnder(env, changedMeanwhile)) ?? null,
    },
  };
}
