import { availableParallelism } from "node:os";
import { compare } from "../../fs/compare.js";
import type { RelativePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import type { RunnerAdapter } from "../../types/runner.js";
import { type EstimateGroup, estimateRun, type RunEstimate } from "./estimate.js";
import { loaderOrder } from "./order.js";
import type { TestFileEvidence } from "./types.js";

/*
 * Spec 020 D17 (row 020-17ab): what the collector does between the stored
 * lookup and the first run. It reads each file to run's closure, gives each
 * runner its files in loader order (D17.2), and estimates each runner's run
 * from the stored durations (D17.1). Only the files that will run count.
 */

/** One runner's files that will run here: selected in scope, given by neither the parts nor the stores. */
export interface ToRun {
  readonly kind: TestFileEvidence["runner"];
  readonly adapter: RunnerAdapter;
  readonly files: readonly TestFileRef[];
}

export interface PlanContext {
  /** Every changed path, after path narrowing (D3.1). */
  readonly changed: readonly RelativePath[];
  /** A file's stored seconds, `null` when none is stored; absent when there is no store. */
  readonly durations?: ((ref: TestFileRef) => number | null) | undefined;
  /** node:test's `runner.tierSize`: the processes it starts at once. */
  readonly tierSize: number;
}

/** Each runner's files in loader order, by `runs`' index, and the estimate of each runner kind. */
export interface Plan {
  readonly files: readonly (readonly TestFileRef[])[];
  /** One per runner kind with a file to run, Vitest first. */
  readonly estimates: readonly RunEstimate[];
}

/**
 * Vitest's own width for a project that sets no `maxWorkers`, outside watch
 * mode: one worker per CPU but one (Vitest's `resolveMaxWorkers`).
 */
const vitestWidth = () => Math.max(1, availableParallelism() - 1);

/** D17.1, D17.2: the order and the estimate of `runs`, which run one after another. */
export async function planRuns(runs: readonly ToRun[], context: PlanContext): Promise<Plan> {
  const seconds = context.durations ?? (() => null);
  const files: TestFileRef[][] = [];
  const groups = new Map<TestFileEvidence["runner"], EstimateGroup[]>();
  for (const { kind, adapter, files: refs } of runs) {
    const loads = new Map<TestFileRef, readonly RelativePath[] | null>();
    for (const ref of refs) {
      const paths = await adapter.closure(ref).then(
        (closure) => [...closure.paths].sort(compare),
        () => null,
      );
      loads.set(ref, paths);
    }
    files.push(
      loaderOrder(refs, context.changed, { loads: (ref) => loads.get(ref) ?? null, seconds }),
    );
    if (refs.length === 0) continue;
    const grant = kind === "vitest" ? vitestWidth() : context.tierSize;
    const own = groups.get(kind) ?? [];
    own.push(...byWidth(refs, (ref) => adapter.tierWidth?.(ref, grant) ?? grant, seconds));
    groups.set(kind, own);
  }
  const estimates = [...groups].map(([kind, of]) => estimateRun(kind, of));
  return { files, estimates };
}

/**
 * `refs` grouped by the width they run at. Vitest runs a group of projects
 * at one width, and the projects of one group must share it; a project 1
 * wide runs its files one at a time.
 */
function byWidth(
  refs: readonly TestFileRef[],
  width: (ref: TestFileRef) => number,
  seconds: (ref: TestFileRef) => number | null,
): EstimateGroup[] {
  const groups = new Map<number, (number | null)[]>();
  for (const ref of refs) {
    const at = Math.max(1, width(ref));
    const group = groups.get(at) ?? [];
    group.push(seconds(ref));
    groups.set(at, group);
  }
  return [...groups].map(([w, s]) => ({ width: w, seconds: s }));
}
