import { availableParallelism } from "node:os";
import { compare } from "../../fs/compare.js";
import { testFileId } from "../../keys/reverse-index.js";
import { shellWord } from "../../text.js";
import type { RelativePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import {
  type BudgetFit,
  type EstimateGroup,
  estimateAll,
  estimateRun,
  fitBudget,
  type RunEstimate,
} from "./estimate.js";
import { loadsOf } from "./evidence.js";
import { loaderOrder, splitEarly } from "./order.js";
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
 * Rows 020-45 and 020-46 (#196, #198): it fits the whole run's estimate
 * to what is left of the budget; over it, a rerun command with a fitted
 * `--timeout`; at twice it, the gate stops early, before the files that
 * load no changed function.
 */

/** One runner's run: what the selection picked for it, its place among the picks, its files to run. */
export interface PlannedRun<P extends Picked> {
  readonly pick: P;
  /** Its index among the picks: Vitest, then each node:test entry in the policy's order. */
  readonly index: number;
  /** Its selected files in scope that neither the parts nor the stores gave; in loader order from `inLoaderOrder`. */
  readonly files: readonly TestFileRef[];
  /**
   * Row 020-46: the selected files the gate stopped early before, which
   * `files` leaves out; they load no changed function. Absent when none.
   */
  readonly overBudget?: readonly TestFileRef[];
}

/** D18: the runs in the order they run, and each runner kind's estimate, one per kind with a file to run, in that order. */
export interface RunOrder<P extends Picked> {
  readonly runs: readonly PlannedRun<P>[];
  readonly estimates: readonly RunEstimate[];
  /** Rows 020-45, 020-46: the whole run's estimate, `estimateAll`'s. */
  readonly whole: { readonly seconds: number | null; readonly known: number };
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
  const runners = [...groups].map(([runner, of]) => ({ runner, groups: of }));
  const kinds = runnerOrder(runners);
  const estimates = kinds.flatMap((kind) => {
    const of = groups.get(kind) ?? [];
    return of.length === 0 ? [] : [estimateRun(kind, of)];
  });
  const whole = estimateAll(runners.filter((r) => r.groups.length > 0));
  return {
    runs: kinds.flatMap((kind) => runs.filter((r) => r.pick.kind === kind)),
    estimates,
    whole,
  };
}

/**
 * Rows 020-45, 020-46: `order`'s whole estimate against the whole seconds
 * left of a budget of `budgetSeconds` before `deadline` (a
 * `performance.now()` time).
 */
export function fitOrder(
  order: RunOrder<Picked>,
  budgetSeconds: number,
  deadline: number,
): BudgetFit {
  const leftSeconds = Math.max(0, Math.floor((deadline - performance.now()) / 1000));
  return fitBudget(order.whole, { budgetSeconds, leftSeconds });
}

/** Row 020-46: what an early stop keeps running beside the loaders of a changed function. */
export interface EarlyStop {
  /** The paths of the changed functions. */
  readonly functions: readonly RelativePath[];
  /** The `--test` files, which always run. */
  readonly tests: readonly RelativePath[];
}

/** D17.1, rows 020-45 and 020-46: what the estimate tells beside each runner's estimate. */
export interface BudgetTold {
  readonly fit: BudgetFit;
  /** Row 020-45: the rerun that fits, with its `--timeout`; absent when the run fits or its time is unknown. */
  readonly rerun?: { readonly seconds: number; readonly command: string };
  /** Row 020-46: when the gate stops early, how many files run and the paths of the others, sorted. */
  readonly early?: { readonly run: number; readonly overBudget: readonly RelativePath[] };
}

/** Row 020-45: the rerun command with `seconds` as its `--timeout` when the caller gives none. */
export const defaultRerun =
  (ref: string) =>
  (seconds: number): string =>
    `squeal code --base ${shellWord(ref)} --timeout ${seconds}`;

/** Rows 020-45, 020-46: what `fit` tells, with `runs` as `inLoaderOrder` gave them. */
export function budgetTold(
  fit: BudgetFit,
  runs: readonly PlannedRun<Picked>[],
  command: (seconds: number) => string,
): BudgetTold {
  const { rerunSeconds } = fit;
  if (rerunSeconds === undefined) return { fit };
  const rerun = { seconds: rerunSeconds, command: command(rerunSeconds) };
  if (fit.early !== true) return { fit, rerun };
  const overBudget = runs.flatMap((r) => (r.overBudget ?? []).map((ref) => ref.path));
  const run = runs.reduce((sum, r) => sum + r.files.length, 0);
  return { fit, rerun, early: { run, overBudget: [...new Set(overBudget)].sort(compare) } };
}

/**
 * D17.2: each of `runs` with its files in loader order, from each file's
 * closure. Row 020-46: with `early`, only the files that may load a
 * changed function stay in `files`; the others are its `overBudget`.
 */
export async function inLoaderOrder<P extends Picked>(
  runs: readonly PlannedRun<P>[],
  context: {
    readonly changed: readonly RelativePath[];
    readonly early?: EarlyStop | undefined;
  } & Pick<PlanContext, "durations">,
): Promise<PlannedRun<P>[]> {
  const seconds = context.durations ?? (() => null);
  const { early } = context;
  const ordered: PlannedRun<P>[] = [];
  for (const run of runs) {
    const loads = new Map<TestFileRef, readonly RelativePath[] | null>();
    for (const ref of run.files) {
      loads.set(ref, await loadsOf(run.pick.adapter, ref));
    }
    const inputs = { loads: (ref: TestFileRef) => loads.get(ref) ?? null, seconds };
    const files = loaderOrder(run.files, context.changed, inputs);
    if (early === undefined) {
      ordered.push({ ...run, files });
      continue;
    }
    // A `--test` file, and one only declared `inputs` chose (row 020-35), run whatever they load.
    const declared = new Set((run.pick.byInputs ?? []).map(testFileId));
    const kept = (ref: TestFileRef) =>
      early.tests.includes(ref.path) || declared.has(testFileId(ref));
    const split = splitEarly(files, early.functions, { loads: inputs.loads, kept });
    const skipped = split.overBudget.length === 0 ? {} : { overBudget: split.overBudget };
    ordered.push({ ...run, files: split.run, ...skipped });
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
