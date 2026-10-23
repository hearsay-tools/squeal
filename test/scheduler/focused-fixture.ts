import {
  type FocusedRun,
  focusedMetaKey,
  readFocused,
} from "../../src/core/scheduler/focused-row.js";
import type {
  FocusedFile,
  RunOptions,
  RunReport,
  TestFileRef,
} from "../../src/core/types/index.js";
import { focusedTexts, holdsCheckText } from "../../src/runners/focus.js";
import type { CatchUpRun, CatchUpSide } from "./catch-up-fixture.js";

/*
 * Row 011-145 (spec 011 C4, C5 and C15 as amended 2026-10-23): what the
 * focused tier's scheduler tests share. The catch-up fixture's runner runs
 * one check, `runs`, per file; made to focus here, a run given texts
 * reports only the checks that hold one, with its counts, as a real
 * adapter does (C14).
 */

/** What a focusing side records beside the runner's runs. */
export interface Focusing {
  /** `RunOptions.checks` of each run, by its index in `side.runner.runs`. */
  readonly checks: (readonly FocusedFile[] | undefined)[];
  /** Each value written to the side's focused meta row, in order. */
  readonly writes: FocusedRun[][];
}

/** Makes `side`'s runner focus, and records what each run was given and each row write. */
export function focusing(side: CatchUpSide): Focusing {
  const { runner, store, worktreeId } = side;
  const record: Focusing = { checks: [], writes: [] };
  const run = runner.run.bind(runner);
  Object.assign(runner, {
    focuses: true,
    run: async (files: readonly TestFileRef[], options: RunOptions): Promise<RunReport> => {
      record.checks[runner.runs.length] = options.checks;
      return focused(await run(files, options), options.checks);
    },
  });
  const key = focusedMetaKey(worktreeId);
  const set = store.meta.set.bind(store.meta);
  store.meta.set = (name: string, value: string) => {
    if (name === key) record.writes.push(JSON.parse(value) as FocusedRun[]);
    set(name, value);
  };
  return record;
}

/** `report` as a focusing adapter gives it for `checks`: the selected checks and the counts. */
function focused(report: RunReport, checks: readonly FocusedFile[] | undefined): RunReport {
  if (checks === undefined) return report;
  const selected = (ref: TestFileRef) => focusedTexts(checks, ref);
  const results = report.results.filter((r) => {
    const texts = selected({ project: r.check.project, path: r.check.testPath });
    return texts === null || holdsCheckText(r.check.fullName, texts);
  });
  const focusedFiles = report.completedFiles.filter((f) => selected(f) !== null);
  return {
    ...report,
    results,
    focused: focusedFiles.map((testFile) => ({
      testFile,
      collected: 1,
      matched: results.filter((r) => r.check.testPath === testFile.path).length,
    })),
  };
}

/** `Scheduler.focus`, which every scheduler of this tree has. */
export function focus(
  side: CatchUpSide,
  testFiles: readonly TestFileRef[],
  texts: readonly string[],
  withinMs: number,
): Promise<void> {
  const { scheduler } = side;
  if (scheduler.focus === undefined) throw new Error("the scheduler cannot focus");
  return scheduler.focus(testFiles, texts, withinMs);
}

/** The side's focused runs, oldest first. */
export const focusedRows = (side: CatchUpSide): FocusedRun[] =>
  readFocused(side.store, side.worktreeId);

/** Whether run `i` of `side` was a focused run. */
export const isFocused = (record: Focusing, i: number): boolean => record.checks[i] !== undefined;

/** Each run after the first `after`: its paths, with `focused` when it was given texts. */
export function runsSince(side: CatchUpSide, record: Focusing, after: number): string[] {
  return side.runner.runs
    .slice(after)
    .map(
      (r: CatchUpRun, i) =>
        `${r.files.map((f) => f.path).join(",")}${isFocused(record, after + i) ? " focused" : ""}`,
    );
}
