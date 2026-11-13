import type { TestFileRef } from "./keys.js";

/*
 * Spec 011 C14 (row 011-329, `research/runner-traits.md`): what a runner
 * kind states, once, about how its test files may be scheduled. The
 * scheduler reads them under its lock, so each is synchronous; none is part
 * of a test file's key (task 011-37). Each runner kind states its own in
 * `src/runners/<runner>/traits.ts`; every layer between the scheduler and
 * an adapter carries them whole (`RunnerAdapter.traits`).
 */

/** A runner's traits; every answer has its default and its clamp (`declareTraits`). */
export interface RunnerTraits {
  /**
   * How many test files the last successful `testFiles()` left out because
   * the adapter does not run them, such as Vitest's typecheck files (spec 005
   * D8 step 3, task 005-26). Default 0: the runner lists every file.
   */
  readonly omittedTestFiles: () => number;
  /**
   * How many of `testFiles`, in order, one slow run of theirs starts at
   * once, at least 1. Spec 004 D2: a slow tier of several files starts them
   * all at once, so none starts after an edit or a close; the slow tier
   * takes only these (review 001-394 B2). Default: all of them.
   */
  readonly slowWidth: (testFiles: readonly TestFileRef[]) => number;
  /**
   * How many test files a backlog tier holding `testFile` runs at once at a
   * grant of `grant` workers, at least 1 (spec 011 C4 step 5, task 001-366):
   * Vitest's `maxWorkers` for it, at least 2 and never above the project's
   * own; node:test's and pytest's `runner.tierSize`, whatever the grant. The
   * scheduler budgets the tier's wall time over it and asks the pool for no
   * more. Default: `grant`.
   */
  readonly tierWidth: (testFile: TestFileRef, grant: number) => number;
  /**
   * Which part of a backlog tier `testFile` runs in (task 001-366, review
   * wave-3 B1): the parts of one tier run one after another, so the
   * scheduler sums their wall estimates. A composite's runners share a lane
   * but run in turn. Default `""`: one part.
   */
  readonly tierPart: (testFile: TestFileRef) => string;
  /**
   * Whether an edit's tier holding `testFile` may start beside a backlog
   * tier of its lane (spec 011 C4 step 5 as amended 2026-10-19, task
   * 011-21): node:test and pytest, which cannot cancel a run and start the
   * processes of each run with that run's `childEnv`, so the run's sweep
   * can be its own. Default `false`: the edit cancels the backlog tier
   * instead (Vitest).
   */
  readonly besideBacklog: (testFile: TestFileRef) => boolean;
  /**
   * The test files one backlog slot holding `testFile` runs, at least 1
   * (spec 011 C4 step 5 as amended for slots, task 011-21 slice 2):
   * node:test 1, a process per file; pytest its batch size, light files
   * packed into one process. A runner that answers runs its backlog in
   * slots, up to `runner.tierSize` runs in flight per lane, each storing
   * when it ends. Default `null`: the backlog runs in tiers (Vitest, one
   * run per instance).
   */
  readonly backlogSlot: (testFile: TestFileRef) => number | null;
  /**
   * Whether the adapter that runs `testFile` honours `RunOptions.checks`
   * (spec 011 C14, rows 011-135 and 011-145). Default `false`: it runs
   * whole files only, and is given no focused run.
   */
  readonly focuses: (testFile: TestFileRef) => boolean;
  /**
   * The lane that runs `testFile`: runner instances that run one tier at a
   * time between them. Tiers of different lanes run at once (spec 001 D5 as
   * amended, task 001-140); a tier holds files of one lane. Default `""`:
   * one lane, so one tier at a time.
   */
  readonly lane: (testFile: TestFileRef) => string;
}

/**
 * What a runner kind states: any of the traits, each answering `undefined`
 * where it knows nothing yet, such as Vitest's widths before its first start.
 */
export type TraitStatement = {
  readonly [K in keyof RunnerTraits]?: (
    ...args: Parameters<RunnerTraits[K]>
  ) => ReturnType<RunnerTraits[K]> | undefined;
};

/**
 * A runner's traits from what its kind states (`stated`): the one place
 * every default and clamp is written. A trait it does not state, or answers
 * `undefined` for, answers its default; a width answers at least 1, and a
 * slot `null` or a whole number of files, at least 1.
 */
export function declareTraits(stated: TraitStatement = {}): RunnerTraits {
  const { omittedTestFiles, slowWidth, tierWidth, tierPart, besideBacklog, backlogSlot } = stated;
  const { focuses, lane } = stated;
  return {
    omittedTestFiles: () => omittedTestFiles?.() ?? 0,
    slowWidth: (testFiles) => Math.max(1, slowWidth?.(testFiles) ?? testFiles.length),
    tierWidth: (testFile, grant) => Math.max(1, tierWidth?.(testFile, grant) ?? grant),
    tierPart: (testFile) => tierPart?.(testFile) ?? "",
    besideBacklog: (testFile) => besideBacklog?.(testFile) ?? false,
    backlogSlot: (testFile) => {
      const files = backlogSlot?.(testFile) ?? null;
      return files === null ? null : Math.max(1, Math.floor(files));
    },
    focuses: (testFile) => focuses?.(testFile) ?? false,
    lane: (testFile) => lane?.(testFile) ?? "",
  };
}

/** The traits of a runner that states none: every default. */
export const NO_TRAITS: RunnerTraits = declareTraits();

/**
 * The traits `current` answers at each read, for a holder whose runner
 * changes under it: the recovering runner's adapter, created, closed when
 * idle and replaced (spec 021 D7, D20.1). It adds no default of its own.
 */
export function liveTraits(current: () => RunnerTraits): RunnerTraits {
  return {
    omittedTestFiles: () => current().omittedTestFiles(),
    slowWidth: (testFiles) => current().slowWidth(testFiles),
    tierWidth: (testFile, grant) => current().tierWidth(testFile, grant),
    tierPart: (testFile) => current().tierPart(testFile),
    besideBacklog: (testFile) => current().besideBacklog(testFile),
    backlogSlot: (testFile) => current().backlogSlot(testFile),
    focuses: (testFile) => current().focuses(testFile),
    lane: (testFile) => current().lane(testFile),
  };
}
