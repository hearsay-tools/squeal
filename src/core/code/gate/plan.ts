import { availableParallelism } from "node:os";
import type { RelativePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import { type EstimateGroup, estimateRun, type RunEstimate } from "./estimate.js";
import { loadsOf } from "./evidence.js";
import { loaderOrder } from "./order.js";
import type { KnownEvidence, Picked } from "./prerun.js";
import { runnerOrder } from "./runner-order.js";
import type { TestFileEvidence } from "./types.js";

/*
 * Spec 020 D17, D18 (rows 020-17ab, 020-19): what the collector does
 * between the stored lookup and the first run. It estimates each runner's
 * run from the stored durations (D17.1) and orders the runners by that
 * estimate (D18), with no closure read, so before the selection is told.
 * Then it reads each file to run's closure and gives each runner its files
 * in loader order (D17.2). Only the files that will run count.
 */

/** One runner's run: what the selection picked for it, its place among the picks, its files to run. */
export interface PlannedRun<P extends Picked> {
  readonly pick: P;
  /** Its index among the picks: Vitest, then each node:test entry in the policy's order. */
  readonly index: number;
  /** Its selected files in scope that neither the parts nor the stores gave; in loader order from `inLoaderOrder`. */
  readonly files: readonly TestFileRef[];
}

/** D18: the runs in the order they run, and each runner kind's estimate, one per kind with a file to run, in that order. */
export interface RunOrder<P extends Picked> {
  readonly runs: readonly PlannedRun<P>[];
  readonly estimates: readonly RunEstimate[];
}

export interface PlanContext {
  /** A file's stored seconds, `null` when none is stored; absent when there is no store. */
  readonly durations?: ((ref: TestFileRef) => number | null) | undefined;
  /** node:test's `runner.tierSize`: the processes it starts at once. */
  readonly tierSize: number;
}

/**
 * Vitest's own width for a project that sets no `maxWorkers`, outside watch
 * mode: one worker per CPU but one (Vitest's `resolveMaxWorkers`).
 */
const vitestWidth = () => Math.max(1, availableParallelism() - 1);

/**
 * D17.1, D18: each of `picked`'s files to run, those `known` does not give,
 * estimated per runner kind, and the picks in the order they run: the
 * runner kinds in ascending order of their estimate, each kind's picks in
 * their own order. Reads no closure.
 */
export function orderRuns<P extends Picked>(
  picked: readonly P[],
  known: KnownEvidence,
  context: PlanContext,
): RunOrder<P> {
  const seconds = context.durations ?? (() => null);
  const runs = picked.map((pick, index) => {
    return { pick, index, files: pick.run.filter((ref) => !known.has(ref)) };
  });
  const groups = new Map<TestFileEvidence["runner"], EstimateGroup[]>();
  for (const { pick, files } of runs) {
    const own = groups.get(pick.kind) ?? [];
    groups.set(pick.kind, own);
    const grant = pick.kind === "vitest" ? vitestWidth() : context.tierSize;
    const width = (ref: TestFileRef) => pick.adapter.tierWidth?.(ref, grant) ?? grant;
    own.push(...byWidth(files, width, seconds));
  }
  const kinds = runnerOrder([...groups].map(([runner, of]) => ({ runner, groups: of })));
  const estimates = kinds.flatMap((kind) => {
    const of = groups.get(kind) ?? [];
    return of.length === 0 ? [] : [estimateRun(kind, of)];
  });
  return { runs: kinds.flatMap((kind) => runs.filter((r) => r.pick.kind === kind)), estimates };
}

/** D17.2: each of `runs` with its files in loader order, from each file's closure. */
export async function inLoaderOrder<P extends Picked>(
  runs: readonly PlannedRun<P>[],
  context: { readonly changed: readonly RelativePath[] } & Pick<PlanContext, "durations">,
): Promise<PlannedRun<P>[]> {
  const seconds = context.durations ?? (() => null);
  const ordered: PlannedRun<P>[] = [];
  for (const run of runs) {
    const loads = new Map<TestFileRef, readonly RelativePath[] | null>();
    for (const ref of run.files) {
      loads.set(ref, await loadsOf(run.pick.adapter, ref));
    }
    const inputs = { loads: (ref: TestFileRef) => loads.get(ref) ?? null, seconds };
    ordered.push({ ...run, files: loaderOrder(run.files, context.changed, inputs) });
  }
  return ordered;
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
