import { declareTraits, type RunnerTraits } from "../../core/types/runner-traits.js";
import { DEFAULT_BATCH_SIZE } from "./run/run.js";

/*
 * Spec 011 C14 (row 011-329): Jest's traits, the same before its adapter
 * exists, in this process and in a runner host. No adapter loads with it.
 */

/** What Jest's traits answer from. */
export interface JestTraitValues {
  /** Policy `runner.tierSize`, read at each answer; absent, not known. */
  readonly tierSize?: (() => number | undefined) | undefined;
  /** The project's `batchSize`, read at each answer; absent, the default batch (spec 028 D4.1). */
  readonly batchSize?: (() => number | undefined) | undefined;
}

/** Jest's traits over `values`. */
export function jestTraits(values: JestTraitValues = {}): RunnerTraits {
  const { tierSize, batchSize } = values;
  return declareTraits({
    // A run starts `runner.tierSize` batches at once whatever its grant (task 001-366).
    tierWidth: () => tierSize?.(),
    // It cannot cancel a run: an edit's tier starts beside a backlog tier (task 011-21).
    besideBacklog: () => true,
    // A slot is one batch process (spec 028 D4.1): light files packed, a slow file alone.
    backlogSlot: () => batchSize?.() ?? DEFAULT_BATCH_SIZE,
  });
}
