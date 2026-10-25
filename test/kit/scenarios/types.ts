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
  /**
   * A test file with one check: the `value` of module `from` equals
   * `expect`. Module `from` is imported by its name, or, when it is a
   * `hook`, read from what the startup hooks shared.
   */
  | {
      readonly kind: "test";
      readonly check: string;
      readonly from: string;
      readonly expect: number;
    }
  /** A test file with one check that loads module `from` by a path computed at run time. */
  | {
      readonly kind: "computed";
      readonly check: string;
      readonly from: string;
      readonly expect: number;
    }
  /**
   * A startup hook: the runner loads it before each test file. It loads
   * module `from` by a path computed at run time and shares its `value`.
   */
  | { readonly kind: "hook"; readonly from: string }
  /** An installed package that exports `value`; another value is another version. */
  | { readonly kind: "dependency"; readonly value: number }
  /**
   * A test file whose check `check` passes, then whose check `holds`
   * writes the file `<module name>.started` at the fixture root and never
   * ends: a run of it ends only when it is cut.
   */
  | { readonly kind: "held"; readonly check: string; readonly holds: string }
  /** A module that fails to load: a syntax error. */
  | { readonly kind: "broken" }
  /** A module with no file yet. */
  | { readonly kind: "absent" };

/** A module that has a file. */
export type Written = Exclude<Module, { kind: "absent" }>;

/**
 * How one check of a test module ended. `unknown`: its file did not
 * complete. `absent`: its file completed with no result for it.
 */
export type Outcome = RunOutcome | "file-error" | "unknown" | "absent";

export type Step =
  /**
   * Writes module `edit` as `to`, then hands the edit to the adapter as
   * the core does: `invalidate` and `affected` for a path in the worktree,
   * `recheck` for one outside it. Each test module of `reaches` must be in
   * `affected`, or hold the edited path in its `closure()` or in the last
   * run's observations, or name the edited package in its closure's
   * packages, or be of a project whose environment lists the path or was
   * recreated with another environment. `sameStat`: the edit keeps the
   * file's size and its mtime (row 007-29).
   */
  | {
      readonly edit: string;
      readonly to: Written;
      readonly reaches: readonly string[];
      readonly sameStat?: true;
    }
  /**
   * Runs every test module; each named one's check must end as given.
   * `cut`: once held module `cut` writes its started file, the run is
   * aborted for the cause the pack cuts for, as the scheduler cancels a
   * tier.
   */
  | {
      readonly run: true;
      readonly expect: Readonly<Record<string, Outcome>>;
      readonly cut?: string;
    }
  /**
   * The precondition of a scenario that depends on a path missing from
   * the static closure: no test module of `of` holds module `lacks` in
   * its `closure()`, and no environment lists it.
   */
  | { readonly lacks: string; readonly of: readonly string[] };

export interface Scenario {
  /** `K1`, `K2`: what a pack's `known` names. */
  readonly name: string;
  readonly title: string;
  readonly modules: Readonly<Record<string, Module>>;
  readonly steps: readonly Step[];
}

/** The test file kinds; `held` checks are named `check` and `holds`. */
type Test = Extract<Module, { kind: "test" | "computed" | "held" }>;

/** True for the modules a pack renders as test files. */
export const isTest = (module: Module): module is Test =>
  module.kind === "test" || module.kind === "computed" || module.kind === "held";
