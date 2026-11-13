import { declareTraits, type RunnerTraits } from "../../core/types/runner-traits.js";
import { DEFAULT_BATCH_SIZE } from "./run/run.js";

/*
 * Spec 011 C14 (row 011-329): pytest's traits, the same before its adapter
 * exists, in this process and in a runner host. No adapter loads with it.
 */

/** What pytest's traits answer from. */
export interface PytestTraitValues {
  /** Policy `runner.tierSize`, read at each answer; absent, not known. */
  readonly tierSize?: (() => number | undefined) | undefined;
  /** The project's `batchSize`, read at each answer; absent, the default batch (spec 007 D6). */
  readonly batchSize?: (() => number | undefined) | undefined;
}

/** pytest's traits over `values`. */
export function pytestTraits(values: PytestTraitValues = {}): RunnerTraits {
  const { tierSize, batchSize } = values;
  return declareTraits({
    // A run starts `runner.tierSize` processes at once whatever its grant (task 001-366).
    tierWidth: () => tierSize?.(),
    // It cannot cancel a run: an edit's tier starts beside a backlog tier (task 011-21).
    besideBacklog: () => true,
    // A slot is one batch process (spec 007 D6): light files packed, a heavy file alone.
    backlogSlot: () => batchSize?.() ?? DEFAULT_BATCH_SIZE,
    // Spec 007 D6 (row 011-145): its deselection hook runs a focused tier's texts.
    focuses: () => true,
  });
}
