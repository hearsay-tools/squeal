import type { RunOutcome } from "../../../src/core/types/index.js";

/*
 * Spec 016 D1: a scenario is abstract modules, an edit script, and after
 * each step the expected outcome of each check and the expected reach. A
 * pack renders the modules in its runner's language; nothing here names a
 * runner.
 */

/** A module of a scenario's fixture, stated in no runner's language. */
export type Module =
  /** Exports `value`. */
  | { readonly kind: "value"; readonly value: number }
  /** Exports the `value` of module `from`. */
  | { readonly kind: "reexport"; readonly from: string }
  /** A test file with one check: the `value` of module `from` equals `expect`. */
  | {
      readonly kind: "test";
      readonly check: string;
      readonly from: string;
      readonly expect: number;
    }
  /** A module that fails to load: a syntax error. */
  | { readonly kind: "broken" };

/**
 * How one check of a test module ended. `unknown`: its file did not
 * complete. `absent`: its file completed with no result for it.
 */
export type Outcome = RunOutcome | "file-error" | "unknown" | "absent";

export type Step =
  /**
   * Rewrites module `edit` as `to`, then calls `invalidate` and `affected`
   * as a revision does. Each test module of `reaches` must be in `affected`,
   * or hold the edited path in its `closure()` or in the last run's
   * observations.
   */
  | { readonly edit: string; readonly to: Module; readonly reaches: readonly string[] }
  /** Runs every test module; each named one's check must end as given. */
  | { readonly run: true; readonly expect: Readonly<Record<string, Outcome>> };

export interface Scenario {
  /** `K1`, `K2`: what a pack's `known` names. */
  readonly name: string;
  readonly title: string;
  readonly modules: Readonly<Record<string, Module>>;
  readonly steps: readonly Step[];
}

/** True for the modules a pack renders as test files. */
export const isTest = (module: Module): module is Extract<Module, { kind: "test" }> =>
  module.kind === "test";
