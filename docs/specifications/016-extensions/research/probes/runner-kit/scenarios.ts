/*
 * THROWAWAY probe for research 016-10. Runner-neutral scenarios: a fixture
 * of abstract modules, an edit script, and the expected outcome of every
 * check after every step. A pack (`packs.ts`) renders the modules in one
 * runner's language; nothing here names a runner.
 */

/** A module in the fixture, stated without a language. */
export type Module =
  | { readonly kind: "value"; readonly value: number }
  | { readonly kind: "reexport"; readonly from: string }
  | { readonly kind: "test"; readonly check: string; readonly from: string; readonly expect: number }
  | { readonly kind: "computed"; readonly check: string; readonly from: string; readonly expect: number }
  | { readonly kind: "broken"; readonly check: string; readonly missing: string };

export type Outcome = "pass" | "fail" | "file-error" | "absent";

export type Step =
  /** Rewrite a value module, then `invalidate` and `affected` as a revision's runner part. */
  | {
      readonly edit: string;
      readonly value: number;
      /** Test modules the change must reach through `affected`, or through closure plus observed reads. */
      readonly reaches: readonly string[];
      /** Keep the file's size and set its mtime back to the one before the edit (row 007-29). */
      readonly sameStat?: true;
    }
  /** Run every test module; each named check must end as given. */
  | { readonly run: true; readonly expect: Readonly<Record<string, Outcome>> }
  /** The test module's closure, with what the last run observed, must hold the module, or lack it. */
  | { readonly holds: string; readonly module: string; readonly lacks?: true };

export interface Scenario {
  readonly name: string;
  readonly modules: Readonly<Record<string, Module>>;
  readonly steps: readonly Step[];
}

/** Brief 016-10 scenarios 1 to 3 and 5: flip, recover, two imports away, a file that fails to load. */
export const FLIP: Scenario = {
  name: "flip-recover-two-hops",
  modules: {
    leaf: { kind: "value", value: 1 },
    mid: { kind: "reexport", from: "leaf" },
    chain: { kind: "test", check: "chain", from: "mid", expect: 1 },
    broken: { kind: "broken", check: "broken", missing: "gone" },
  },
  steps: [
    { run: true, expect: { chain: "pass", broken: "file-error" } },
    { edit: "leaf", value: 2, reaches: ["chain"] },
    { run: true, expect: { chain: "fail", broken: "file-error" } },
    { edit: "leaf", value: 1, reaches: ["chain"] },
    { run: true, expect: { chain: "pass", broken: "file-error" } },
  ],
};

/** Brief 016-10 scenario 10: a runtime read outside the static closure invalidates. */
export const COMPUTED: Scenario = {
  name: "computed-import",
  modules: {
    hidden: { kind: "value", value: 1 },
    loads: { kind: "computed", check: "loads", from: "hidden", expect: 1 },
  },
  steps: [
    // Before any run: the static closure must not see it, or the scenario proves nothing.
    { holds: "loads", module: "hidden", lacks: true },
    { run: true, expect: { loads: "pass" } },
    { holds: "loads", module: "hidden" },
    { edit: "hidden", value: 2, reaches: ["loads"] },
    { run: true, expect: { loads: "fail" } },
  ],
};

/**
 * Row 007-29, found on pytest (a same-size edit within the same second ran
 * the cached `.pyc`): stated once, so every runner's caches meet it.
 */
export const SAME_STAT: Scenario = {
  name: "same-stat-edit",
  modules: {
    leaf: { kind: "value", value: 1 },
    direct: { kind: "test", check: "direct", from: "leaf", expect: 1 },
  },
  steps: [
    { run: true, expect: { direct: "pass" } },
    { edit: "leaf", value: 2, reaches: ["direct"], sameStat: true },
    { run: true, expect: { direct: "fail" } },
    { edit: "leaf", value: 1, reaches: ["direct"], sameStat: true },
    { run: true, expect: { direct: "pass" } },
  ],
};

export const SCENARIOS: readonly Scenario[] = [FLIP, COMPUTED, SAME_STAT];
