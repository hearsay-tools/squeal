import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import type { Checkout } from "../core/checkout/checkout.js";
import { estimateRun, type RunEstimate } from "../core/code/gate/estimate.js";
import type { BeforeRemove, KeyedFile } from "../core/commit/at-keys-checkout.js";
import { committedBlobs } from "../core/commit/tree.js";
import { compare } from "../core/fs/compare.js";
import { runGit } from "../core/fs/git.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { shellWord } from "../core/text.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import { storedDurations } from "./code-gate-durations.js";
import { type GateFileRun, runGateFiles } from "./code-gate-files.js";
import type { RunUse, SideState } from "./status-at-report.js";

/*
 * Spec 023 D4 (row 023-07): `squeal status --at <commit> --run`. In the
 * temporary checkout the keying made, before it is removed (no second
 * checkout, no second install), the files with no result at their key at
 * the commit run through 020's gate as a library (`runGateFiles`), which
 * keeps each completed file in the shared stores at its key (020 D17.3).
 * Selection (D4.5): those the diff `<commit>..HEAD` selects, a file whose
 * closure at the commit loads a changed path; `--all-missing`, every one,
 * after D17.1's estimate. One budget (D4.6) over the checkout, its install
 * and the run. `TMPDIR` is the checkout's run folder; every other variable
 * is the command's, as a daemon has them (D4.4).
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
  /** The user's worktree. */
  readonly root: AbsolutePath;
  /** The commit, resolved, and as the user gave it (for the rerun line). */
  readonly commit: string;
  readonly given: string;
  readonly paths: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  /** `performance.now()` when the budget started: before the checkout. */
  readonly started: number;
  /** The gate's notes and the estimate, one line each. */
  readonly note: (text: string) => void;
}

export interface AtRun {
  readonly beforeRemove: BeforeRemove;
  /** The commit side this command's run gave `ref`; `undefined` when the run did not touch it. */
  state(ref: TestFileRef): SideState | undefined;
  /** D1's budget use, for the report. */
  use(): RunUse;
}

/** D4: the run, as a hook the keying calls in its checkout. */
export function atRun(input: AtRunInput): AtRun {
  const { args, root, commit, started } = input;
  const budgetMs = args.timeoutSeconds * 1000;
  const elapsed = () => performance.now() - started;
  const states = new Map<string, SideState>();
  let selected = 0;
  let gateMs: number | null = null;
  let timedOut = false;
  let estimate: RunEstimate | null = null;
  let leftOut: readonly KeyedFile[] = [];
  let overheadMs = 0;
  let durationsOf: (ref: TestFileRef) => number | null = () => null;

  const beforeRemove: BeforeRemove = async (checkout, keyed) => {
    const missing = keyed.filter((f) => "key" in f.at && f.at.stored.length === 0);
    const blobs = await committedBlobs(root, commit);
    const changed = args.allMissing ? null : await changedSince(root, commit);
    const run: KeyedFile[] = [];
    for (const file of missing) {
      const loads = "key" in file.at ? (file.at.loads ?? []) : [];
      // D4.9: a closure that reads a path git does not hold at the commit cannot be compared. A
      // path absent from the checkout too (a snapshot not written yet) reads absent, as there.
      const needs = loads.find((path) => !blobs.has(path) && existsSync(join(checkout.tree, path)));
      if (needs !== undefined) {
        states.set(testFileId(file.ref), { state: "not comparable", reason: `needs ${needs}` });
      } else if (changed === null || [file.ref.path, ...loads].some((p) => changed.has(p))) {
        run.push(file);
      }
    }
    selected = run.length;
    const durations = storedDurations(checkout.tree);
    durationsOf = durations?.of ?? (() => null);
    try {
      estimate = estimateOf(run, durationsOf);
      if (args.allMissing) input.note(estimateText(estimate, commit, args.timeoutSeconds));
      if (run.length > 0) await runFiles(checkout, run);
    } finally {
      durations?.close();
    }
  };

  async function runFiles(checkout: Checkout, run: readonly KeyedFile[]): Promise<void> {
    overheadMs = elapsed();
    const left = Math.floor((budgetMs - overheadMs) / 1000);
    if (left < 1) {
      timedOut = true;
      for (const file of run)
        states.set(testFileId(file.ref), { state: "not run", reason: "budget" });
      leftOut = run;
      return;
    }
    const files = [...new Set(run.map((f) => f.ref.path))].sort(compare);
    const gateStarted = performance.now();
    try {
      const result = await runGateFiles({
        root: checkout.tree,
        files,
        budgetSeconds: left,
        env: input.env,
        tempDir: checkout.run,
        note: input.note,
        output: () => {},
      });
      timedOut = result.timedOut;
      const byPath = new Map(result.runs.map((r) => [r.path, r]));
      for (const file of run) {
        const state = stateOfRun(byPath.get(file.ref.path), file, commit);
        states.set(testFileId(file.ref), state);
      }
    } catch (error) {
      const reason = `run: ${error instanceof Error ? error.message : String(error)}`;
      for (const file of run) states.set(testFileId(file.ref), { state: "not determined", reason });
    } finally {
      gateMs = Math.round(performance.now() - gateStarted);
    }
    leftOut = run.filter((f) => states.get(testFileId(f.ref))?.state === "not run");
  }

  const use = (): RunUse => {
    const count = (state: SideState["state"]) =>
      [...states.values()].filter((s) => s.state === state).length;
    const notRun = [...states.values()].filter((s) => s.state === "not run").length;
    return {
      timeoutSeconds: args.timeoutSeconds,
      usedMs: Math.round(elapsed()),
      gateMs,
      selected,
      ran: count("pass") + count("fail"),
      notRun,
      notComparable: count("not comparable"),
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

  return { beforeRemove, state: (ref) => states.get(testFileId(ref)), use };
}

/** The paths the diff `<commit>..HEAD` changes, renames as both sides. */
async function changedSince(root: AbsolutePath, commit: string): Promise<ReadonlySet<string>> {
  const out = await runGit(root, ["diff", "--name-only", "--no-renames", "-z", commit, "HEAD"]);
  return new Set(out.split("\0").filter((path) => path !== ""));
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

/** The commit side `run` gave `file`: pass or fail by this command, or not run. */
function stateOfRun(run: GateFileRun | undefined, file: KeyedFile, commit: string): SideState {
  if (run === undefined || !("key" in file.at)) {
    return { state: "not determined", reason: "the run gave it no outcome" };
  }
  const { key } = file.at;
  const origin = { kind: "run", worktreeId: null, commit } as const;
  if (run.outcome === "passed") return { state: "pass", key, origin };
  if (run.outcome === "failed") {
    const failed = [...new Set(run.failed.map((f) => f.test))].sort(compare);
    return { state: "fail", key, origin, failed };
  }
  return { state: "not run", reason: run.reason === "prepare" ? "prepare" : "budget" };
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
