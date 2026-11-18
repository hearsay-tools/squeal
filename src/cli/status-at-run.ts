import { availableParallelism } from "node:os";
import type { Checkout } from "../core/checkout/checkout.js";
import { estimateRun, type RunEstimate } from "../core/code/gate/estimate.js";
import {
  type BeforeRemove,
  type KeyedFile,
  type Rekey,
  rekeyed,
  type WhileOpen,
} from "../core/commit/at-keys-checkout.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { shellWord } from "../core/text.js";
import type { AbsolutePath, WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import { storedDurations } from "./code-gate-durations.js";
import type { RunUse, SideState } from "./status-at-report.js";
import { runInChild } from "./status-at-run-child.js";
import { outcomesOf } from "./status-at-run-outcome.js";
import { noResult, type Selection, selector } from "./status-at-run-select.js";

/*
 * Spec 023 D4 (row 023-07): `squeal status --at <commit> --run`. In the
 * temporary checkout the keying made, before it is removed (no second
 * checkout, no second install), the files with no result at their key at
 * the commit run through 020's gate (`runGateFiles`), which keeps each
 * completed file in the shared stores at its key (020 D17.3). Selection
 * (D4.5, `status-at-run-select.ts`) is asked of the keyer's adapters while
 * they are open; `--all-missing` runs every file with no result, after
 * D17.1's estimate. One budget (D4.6) over the checkout, its install and
 * the run. The gate runs in a child that leads its own process group
 * (`status-at-run-child.ts`), under the command's environment as it
 * started, with `TMPDIR` the checkout's run folder (D4.4). Each file's
 * state is read back per project from the store (`status-at-run-outcome.ts`).
 */

/** `--run` and what goes with it. */
export interface RunArgs {
  readonly allMissing: boolean;
  /** D4.6: the one budget, the checkout and install included. */
  readonly timeoutSeconds: number;
}

/** D4.6's default budget. */
export const RUN_TIMEOUT_SECONDS = 600;

/** A rerun's `--timeout` gives the files left this many times their estimate (020 row 020-45). */
const RERUN_FACTOR = 2;

export interface AtRunInput {
  readonly args: RunArgs;
  /** The user's worktree, its git common dir, and this worktree's id. */
  readonly root: AbsolutePath;
  readonly commonDir: AbsolutePath;
  readonly own: WorktreeId;
  /** The commit, resolved, and as the user gave it (for the rerun line). */
  readonly commit: string;
  readonly given: string;
  readonly paths: readonly string[];
  /** The command's environment as it started: the run's (D4.4). */
  readonly env: NodeJS.ProcessEnv;
  /** The command that runs this CLI (`CliIo.relaunch`), for the run's child. */
  readonly relaunch: readonly string[] | undefined;
  /** `performance.now()` when the budget started: before the checkout. */
  readonly started: number;
  /** The estimate, one line. */
  readonly note: (text: string) => void;
  /** The run's own output (the gate's notes), as it comes. */
  readonly forward: (text: string) => void;
}

export interface AtRun {
  readonly whileOpen: WhileOpen;
  readonly beforeRemove: BeforeRemove;
  /** The commit side this command's run gave `ref`; `undefined` when the run did not touch it. */
  state(ref: TestFileRef): SideState | undefined;
  /** D1's budget use, for the report. */
  use(): RunUse;
}

/** D4: the run, as hooks the keying calls in its checkout. */
export function atRun(input: AtRunInput): AtRun {
  const { args, commit, started } = input;
  const budgetMs = args.timeoutSeconds * 1000;
  const elapsed = () => performance.now() - started;
  const states = new Map<string, SideState>();
  let selection: Selection = { run: [], states: new Map() };
  let gateMs: number | null = null;
  let timedOut = false;
  let estimate: RunEstimate | null = null;
  let leftOut: readonly KeyedFile[] = [];
  let overheadMs = 0;
  let durationsOf: (ref: TestFileRef) => number | null = () => null;
  let changed: string | null = null;

  const whileOpen = selector(
    { root: input.root, commit, allMissing: args.allMissing },
    (chosen) => {
      selection = chosen;
    },
  );

  const beforeRemove: BeforeRemove = async (checkout, keyed, change, rekey) => {
    changed = change;
    for (const [id, state] of selection.states) states.set(id, state);
    const { run } = selection;
    const durations = storedDurations(checkout.tree);
    durationsOf = durations?.of ?? (() => null);
    try {
      estimate = estimateOf(run, durationsOf);
      if (args.allMissing) input.note(estimateText(estimate, commit, args.timeoutSeconds));
      if (run.length > 0) await runFiles(checkout, run, keyed, rekey);
    } finally {
      durations?.close();
    }
  };

  async function runFiles(
    checkout: Checkout,
    run: readonly KeyedFile[],
    keyed: readonly KeyedFile[],
    rekey: Rekey,
  ): Promise<void> {
    overheadMs = elapsed();
    const left = Math.floor((budgetMs - overheadMs) / 1000);
    if (left < 1) {
      timedOut = true;
      for (const file of run)
        states.set(testFileId(file.ref), { state: "not run", reason: "budget" });
      leftOut = run;
      return;
    }
    const files = [...new Set(run.map((f) => f.ref.path))].sort();
    const gateStarted = performance.now();
    const answer = await runInChild({
      relaunch: input.relaunch,
      checkout,
      files,
      budgetSeconds: left,
      // "Whole-checkout check": a checkout the install changed stores nothing.
      store: changed === null,
      env: input.env,
      forward: input.forward,
    });
    gateMs = Math.round(performance.now() - gateStarted);
    if ("result" in answer) timedOut = answer.result.timedOut;
    const chosen = new Set(run.map((f) => testFileId(f.ref)));
    const paths = new Set(run.map((f) => f.ref.path));
    const siblings = keyed.filter(
      (f) => noResult(f) && paths.has(f.ref.path) && !chosen.has(testFileId(f.ref)),
    );
    // Row 023-18 (D1): a stored run is read at the key it was kept at, which its reads can move.
    const both = [...run, ...siblings];
    const read = changed === null && "result" in answer ? await rekeyed(both, rekey) : both;
    const outcomes = await outcomesOf({
      commonDir: input.commonDir,
      commit,
      own: input.own,
      run: read.slice(0, run.length),
      siblings: read.slice(run.length),
      answer,
      changed,
    });
    for (const [id, state] of outcomes) states.set(id, state);
    leftOut = run.filter((f) => states.get(testFileId(f.ref))?.state === "not run");
  }

  const use = (): RunUse => {
    const all = [...states.values()];
    const ran = all.filter(
      (s) => s.state === "pass" || s.state === "fail" || (s.state === "not comparable" && s.ran),
    );
    const notRun = all.filter((s) => s.state === "not run").length;
    return {
      timeoutSeconds: args.timeoutSeconds,
      usedMs: Math.round(elapsed()),
      gateMs,
      selected: selection.run.length,
      ran: ran.length,
      stored: ran.filter((s) => "origin" in s && s.origin.stored === true).length,
      changed,
      notRun,
      notComparable: all.filter((s) => s.state === "not comparable").length,
      timedOut,
      estimate,
      rerun: notRun === 0 ? null : rerunCommand(input, rerunSeconds()),
    };
  };

  /** Row 020-45's rule: what was spent before the run, plus twice the files left's estimate. */
  const rerunSeconds = (): number => {
    const left = estimateOf(leftOut, durationsOf).seconds;
    const seconds =
      left === null
        ? RERUN_FACTOR * args.timeoutSeconds
        : overheadMs / 1000 + RERUN_FACTOR * Math.max(1, left);
    return Math.max(60, Math.ceil(seconds / 60) * 60);
  };

  return { whileOpen, beforeRemove, state: (ref) => states.get(testFileId(ref)), use };
}

/** D17.1: the files' estimate from their stored durations, as one Vitest-wide run. */
function estimateOf(
  files: readonly KeyedFile[],
  durationOf: (ref: TestFileRef) => number | null,
): RunEstimate {
  const width = Math.max(1, availableParallelism() - 1);
  return estimateRun("vitest", [{ width, seconds: files.map((f) => durationOf(f.ref)) }]);
}

/** D4.5: `--all-missing`'s estimate line, told before the run. */
export function estimateText(estimate: RunEstimate, commit: string, budget: number): string {
  const { files, seconds, known, width } = estimate;
  const what = `${files} test file${files === 1 ? "" : "s"} with no result at ${commit.slice(0, 9)} to run, up to ${width} at once`;
  const budgetText = `the budget is ${budget} s, the checkout and install included`;
  if (files === 0) return `--all-missing: no test file with no result at ${commit.slice(0, 9)}`;
  if (seconds === null)
    return `--all-missing: ${what}; no stored duration, so the time is unknown; ${budgetText}`;
  const from =
    known < files
      ? `the stored durations of ${known} (the others at their median)`
      : files === 1
        ? "its stored duration"
        : "their stored durations";
  return `--all-missing: ${what}: about ${seconds} s from ${from}; ${budgetText}`;
}

/** 020's rerun line: this call's own arguments with `seconds` as its `--timeout`. */
function rerunCommand(input: AtRunInput, seconds: number): string {
  const words = [
    "squeal status --at",
    shellWord(input.given),
    ...input.paths.map(shellWord),
    "--run",
    ...(input.args.allMissing ? ["--all-missing"] : []),
    "--timeout",
    String(seconds),
  ];
  return words.join(" ");
}
