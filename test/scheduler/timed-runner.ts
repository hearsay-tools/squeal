import type {
  RunnerAdapter,
  RunOptions,
  RunReport,
  TestFileRef,
} from "../../src/core/types/index.js";

/*
 * Task 011-21 slice 2: a runner whose runs a test times, and whose backlog
 * slots it can turn off. Apart from `slots-fixture.ts`, so a test of another
 * runner's slots does not import node:test's (`test/version-sensitive.txt`).
 */

/** One `run` call the scheduler made, timed on the epoch clock. */
export interface TimedRun {
  readonly files: readonly TestFileRef[];
  readonly options: RunOptions;
  readonly start: number;
  end: number | null;
  report: RunReport | null;
}

/**
 * `runner` with each `run` call timed into `runs`; while `slots` says false
 * its `backlogSlot` answers `null`, so its backlog runs in tiers, as before
 * slots.
 */
export function timedRunner(
  runner: RunnerAdapter,
  slots: () => boolean = () => true,
): { timed: RunnerAdapter; runs: TimedRun[] } {
  const runs: TimedRun[] = [];
  const timed: RunnerAdapter = Object.create(runner, {
    run: {
      value: async (files: readonly TestFileRef[], runOptions: RunOptions) => {
        const run: TimedRun = {
          files,
          options: runOptions,
          start: Date.now(),
          end: null,
          report: null,
        };
        runs.push(run);
        run.report = await runner.run(files, runOptions);
        run.end = Date.now();
        return run.report;
      },
    },
    backlogSlot: {
      value: (testFile: TestFileRef) => (slots() ? (runner.backlogSlot?.(testFile) ?? null) : null),
    },
  });
  return { timed, runs };
}
