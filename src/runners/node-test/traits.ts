import { declareTraits, type RunnerTraits } from "../../core/types/runner-traits.js";

/*
 * Spec 011 C14 (row 011-329): node:test's traits, the same before its
 * adapter exists, in this process and in a runner host. Light: no adapter
 * loads with it.
 */

/** What node:test's traits answer from. */
export interface NodeTestTraitValues {
  /** Policy `runner.tierSize`, read at each answer; absent, not known. */
  readonly tierSize?: (() => number | undefined) | undefined;
}

/** node:test's traits over `values`. */
export function nodeTestTraits(values: NodeTestTraitValues = {}): RunnerTraits {
  const { tierSize } = values;
  return declareTraits({
    // A run starts `runner.tierSize` files at once whatever its grant (task 001-366).
    tierWidth: () => tierSize?.(),
    // It cannot cancel a run: an edit's tier starts beside a backlog tier (task 011-21).
    besideBacklog: () => true,
    // A process per file: the backlog runs in one-file slots (task 011-21 slice 2).
    backlogSlot: () => 1,
  });
}
