import type { Checkout } from "../core/checkout/checkout.js";
import { coverageOn } from "../core/code/coverage/runtime.js";
import type { RunEstimate } from "../core/code/gate/estimate.js";
import type { BeforeRemove, KeyedFile, WhileOpen } from "../core/commit/at-keys-checkout.js";
import { checkoutChange } from "../core/commit/at-keys-verify.js";
import type { Changed } from "../core/commit/at-keys-walk.js";
import { readPolicy } from "../core/daemon/policy.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { AbsolutePath, RelativePath, WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import { storedDurations } from "./code-gate-durations.js";
import type { RunUse, SideState } from "./status-at-report.js";
import type { NowRunUse } from "./status-at-report-run.js";
import {
  type BatchTime,
  estimateOf,
  estimateText,
  tellsEstimate,
} from "./status-at-run-batches.js";
import { type RunAnswer, runInChild } from "./status-at-run-child.js";
import { clearlyOver, measuredOver, ranCount, type SideFit } from "./status-at-run-fit.js";
import { runBatches } from "./status-at-run-loop.js";
import { outcomesOf } from "./status-at-run-outcome.js";
import { noResult, type Selection, selector } from "./status-at-run-select.js";
import { unkept } from "./status-at-run-unkept.js";
import { runUse } from "./status-at-run-use.js";

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
  /**
   * Row 023-34 (T1, spec 023 D4.11): the call gave neither `--timeout`
   * nor `--all-missing`, so a selection that clearly cannot fit runs
   * nothing (`clearlyOver`); either flag runs what fits.
   */
  readonly fitCheck?: true;
}

/**
 * D4.6's default budget, as row 023-19 (P3) set it: 300 s, half of the
 * longest tool call an agent's shell gives (Claude Code's Bash, 600 s), so
 * the current side's keying, the hard stop's margin, the checkout's
 * removal and the report end inside one call on a loaded host. At 600 s
 * the call moved to the background and the agent lost the answer.
 */
export const RUN_TIMEOUT_SECONDS = 300;

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
  /**
   * Row 023-29 (row 023-32's finding): the paths the call names, relative to
   * the root; a test file named so runs with no result, selected by the change or not.
   */
  readonly named?: readonly RelativePath[];
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
  /** Row 023-19, for tests: each batch's paths; else sized from this machine (`Batches`). */
  readonly batchFiles?: number;
  /**
   * Row 023-29 (R1): the working tree's side, which runs while the
   * checkout is open, between this side's first pass and its leftovers, so
   * the time either side leaves unused goes to the other. Absent: none.
   */
  readonly now?: NowTurn;
}

/** R1: the working tree's turn inside the commit side's run. */
export interface NowTurn {
  /** Chooses the working tree's files from the commit side's selection; their count. */
  files(selection: Selection): number;
  /**
   * Runs them (or what is left of them) until `endMs` (`performance.now()`).
   * Row 023-34 (T4): `alone`, the `testFileId`s this side ran and did not keep.
   */
  run(endMs: number, alone: ReadonlySet<string>): Promise<void>;
}

/** R1: the working tree's side, for the report and the rerun's fit. */
export interface NowPart {
  readonly use: NowRunUse;
  readonly fit: SideFit;
}

export interface AtRun {
  readonly whileOpen: WhileOpen;
  readonly beforeRemove: BeforeRemove;
  /**
   * The commit side of `ref`: what this command's run gave it, else
   * `keyed`, the keying's own state, marked (R8) when it has no result and
   * the change did not select it.
   */
  state(ref: TestFileRef, keyed: SideState): SideState;
  /** R1: what the change selects, for the working tree's side; `null` when no selection was made. */
  selects(): NonNullable<Selection["selects"]> | null;
  /** `performance.now()` at which the one budget ends, and the budget in seconds. */
  readonly endMs: number;
  readonly timeoutSeconds: number;
  /** D1's budget use, for the report, with the working tree's side when it ran. */
  use(now?: NowPart): RunUse;
  /** T1: the selection clearly could not fit, so neither side ran. */
  refused(): boolean;
}

/** D4: the run, as hooks the keying calls in its checkout. */
export function atRun(input: AtRunInput): AtRun {
  const { args, commit, started } = input;
  const endMs = started + args.timeoutSeconds * 1000;
  const elapsed = () => performance.now() - started;
  const states = new Map<string, SideState>();
  let selection: Selection = { run: [], states: new Map() };
  let gateMs: number | null = null;
  let timedOut = false;
  let estimate: RunEstimate | null = null;
  let leftOut: readonly KeyedFile[] = [];
  // R4: read while the stored durations are open; after `close()` every lookup reads none.
  let leftSeconds: number | null = null;
  let overheadMs = 0;
  let durationsOf: (ref: TestFileRef) => number | null = () => null;
  let changed: Changed | null = null;
  let batchTimes: readonly BatchTime[] = [];
  /** The gate children started in the checkout, over every pass. */
  let children = 0;
  /**
   * T1: the selection clearly could not fit: from stored durations before
   * it ran, or (review wave-20 B4) at the rate its first batch measured.
   */
  let refused: "estimate" | "measured" | null = null;
  /** B4: while the first batch is measured, the working tree's file count; else `null`. */
  let measuring: number | null = null;

  const whileOpen = selector(
    { root: input.root, commit, allMissing: args.allMissing, named: new Set(input.named ?? []) },
    (chosen) => {
      selection = chosen;
    },
  );

  const beforeRemove: BeforeRemove = async (checkout, keyed, change) => {
    changed = change;
    for (const [id, state] of selection.states) states.set(id, state);
    const { run } = selection;
    const durations = storedDurations(checkout.tree);
    durationsOf = durations?.of ?? (() => null);
    try {
      estimate = estimateOf(run, durationsOf);
      // P3: a large selection tells its estimate, and how to narrow it, before it runs.
      const left = args.timeoutSeconds - elapsed() / 1000;
      if (tellsEstimate(estimate, args.allMissing, left)) {
        const call = { given: input.given, paths: input.paths, allMissing: args.allMissing };
        input.note(estimateText(estimate, commit, args.timeoutSeconds, call));
      }
      // T1: a selection that clearly cannot fit runs on neither side, unless the call forces it.
      if (args.fitCheck === true && clearlyOver(estimate, elapsed())) {
        refused = "estimate";
        for (const f of run) states.set(testFileId(f.ref), { state: "not run", reason: "budget" });
        leftOut = run;
        leftSeconds = estimate.seconds;
        return;
      }
      // R1: each side a share of what is left by its count; what one leaves unused goes on.
      const now = input.now?.files(selection) ?? 0;
      // B4: with no stored duration, the first batch measures the rate before the rest runs.
      if (args.fitCheck === true && estimate.seconds === null) measuring = now;
      if (run.length > 0) await runFiles(checkout, run, keyed, shareEnd(run.length, now));
      measuring = null;
      if (refused !== null) {
        leftOut = budgetLeft(run);
        return;
      }
      if (now > 0) await input.now?.run(shareEnd(now, budgetLeft(run).length), unkeptIds());
      // The first pass had only its share when the working tree had files: its leftovers take
      // the rest, which the working tree's turn did not use.
      const again = budgetLeft(run);
      if (again.length > 0 && now > 0) await runFiles(checkout, again, keyed, endMs);
      leftOut = budgetLeft(run);
      leftSeconds = estimateOf(leftOut, durationsOf).seconds;
    } finally {
      durations?.close();
    }
  };

  /** R1: when a side with `mine` files to run ends, beside `other` files of the other side. */
  const shareEnd = (mine: number, other: number): number => {
    const now = performance.now();
    return now + Math.max(0, endMs - now) * (mine / (mine + other));
  };

  /** Row 023-34 (T4): the files this side ran and did not keep. */
  const unkeptIds = () =>
    new Set([...states].filter(([, state]) => unkept(state)).map(([id]) => id));

  /** The files of `run` the budget left not run. */
  const budgetLeft = (run: readonly KeyedFile[]) =>
    run.filter((f) => {
      const s = states.get(testFileId(f.ref));
      return s?.state === "not run" && s.reason === "budget";
    });

  /** P3 and R3 through `runBatches`, until `until`; a second pass runs the first's leftovers. */
  async function runFiles(
    checkout: Checkout,
    run: readonly KeyedFile[],
    keyed: readonly KeyedFile[],
    until: number,
  ): Promise<void> {
    if (batchTimes.length === 0) overheadMs = elapsed();
    const end = await runBatches({
      files: run,
      refOf: (file) => file.ref,
      policy: readPolicy(checkout.tree),
      timeoutSeconds: args.timeoutSeconds,
      ...(input.batchFiles === undefined ? {} : { batchFiles: input.batchFiles }),
      endMs: until,
      secondsOf: (ref) => durationsOf(ref),
      // Review wave-13 B1: 023-07's whole-checkout check before every child but the checkout's
      // first. A test of an earlier batch may have changed a tracked path; from then on nothing
      // is the commit's. Review wave-18 re-review 2: counted over every pass, so a second pass
      // after the working tree's turn checks too, even when the first pass ended no file.
      beforeEach: async () => {
        if (children === 0 || changed !== null) return;
        const path = await checkoutChange(input.root, checkout.tree, checkout.commit);
        if (path !== null) changed = { path, by: "run" };
      },
      run: (batch, budgetSeconds, stopAfterSeconds) => {
        children++;
        return runInChild({
          relaunch: input.relaunch,
          checkout,
          files: batch.paths,
          // Review wave-18 B3: the batch's own projects only.
          refs: batch.refs,
          budgetSeconds,
          stopAfterSeconds,
          // "Whole-checkout check": a checkout the install or an earlier batch changed stores nothing.
          store: changed === null,
          env: input.env,
          forward: input.forward,
        });
      },
      readBack: (files, answer) => readBack(checkout, files, keyed, answer),
      stateOf: (file) => states.get(testFileId(file.ref)),
      setState: (file, state) => states.set(testFileId(file.ref), state),
      goOn: (ms) => measured(run, ms),
    });
    if (end.gateMs !== null) gateMs = (gateMs ?? 0) + end.gateMs;
    // A file stopped mid-run, or one the last pass left: the budget cut the run.
    timedOut = timedOut || end.cut;
    batchTimes = [...batchTimes, ...end.batches];
  }

  /**
   * B4: after the first batch of a selection with no stored duration,
   * whether the run goes on: not when, at the rate it measured, the files
   * left on both sides clearly cannot fit (`measuredOver`).
   */
  function measured(run: readonly KeyedFile[], ms: number): boolean {
    if (measuring === null) return true;
    const now = measuring;
    measuring = null;
    const done = run.flatMap((f) => states.get(testFileId(f.ref)) ?? []);
    const left = run.length - done.length + now;
    if (!measuredOver(overheadMs, ranCount(done), ms, left)) return true;
    refused = "measured";
    return false;
  }

  /** One batch's files read back (row 023-18, D1: at the key the gate kept each at). */
  async function readBack(
    checkout: Checkout,
    run: readonly KeyedFile[],
    keyed: readonly KeyedFile[],
    answer: RunAnswer,
  ): Promise<void> {
    const chosen = new Set(selection.run.map((f) => testFileId(f.ref)));
    const paths = new Set(run.map((f) => f.ref.path));
    const siblings = keyed.filter(
      (f) => noResult(f) && paths.has(f.ref.path) && !chosen.has(testFileId(f.ref)),
    );
    const outcomes = await outcomesOf({
      commonDir: input.commonDir,
      commit,
      own: input.own,
      run,
      siblings,
      answer,
      changed,
      coverage: coverageOn(readPolicy(checkout.tree)),
    });
    for (const [id, state] of outcomes) states.set(id, state);
  }

  const use = (now?: NowPart): RunUse =>
    runUse(
      {
        call: { given: input.given, paths: input.paths, allMissing: args.allMissing },
        timeoutSeconds: args.timeoutSeconds,
        usedMs: Math.round(elapsed()),
        overheadMs,
        gateMs,
        states: [...states.values()],
        selected: selection.run.length,
        notSelected: selection.unselected?.size ?? 0,
        changed,
        timedOut: timedOut || leftOut.length > 0,
        estimate,
        leftSeconds,
        batches: batchTimes,
        ...(refused === null ? {} : { refused: { measured: refused === "measured" } }),
      },
      now,
    );

  const state = (ref: TestFileRef, keyed: SideState): SideState => {
    const id = testFileId(ref);
    const ran = states.get(id);
    if (ran !== undefined) return ran;
    const unselected = keyed.state === "no result" && selection.unselected?.has(id) === true;
    return unselected ? { ...keyed, notSelected: true } : keyed;
  };

  const selects = () => selection.selects ?? null;
  const { timeoutSeconds } = args;
  return {
    whileOpen,
    beforeRemove,
    state,
    selects,
    endMs,
    timeoutSeconds,
    use,
    refused: () => refused !== null,
  };
}
