import { availableParallelism } from "node:os";
import { estimateRun, type RunEstimate } from "../core/code/gate/estimate.js";
import type { KeyedFile } from "../core/commit/at-keys-checkout.js";
import { shellWord } from "../core/text.js";
import type { RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";

/*
 * Row 023-19 (lessons P3): `--run` runs its selection in batches, one gate
 * child each, so a batch that completed is kept and reported whatever
 * happens to a later one. In the dogfood, 1,338 files with no stored
 * duration ran as one gate run (`chunksFor` makes one chunk when nothing
 * is stored), the run outlived its budget, the parent killed it, and no
 * result was kept or reported. A batch holds whole paths (the gate runs a
 * path under every project that lists it). Its size comes from this
 * machine: the first batch is one round of files at once (Vitest's width,
 * one per CPU but one) or the stored durations' share of the budget; each
 * later batch from the times the batches so far took here (`costOf`).
 */

/** Of the budget, the share one batch aims at: a killed batch loses at most about this much. */
const BATCH_SHARE = 0.2;

/** The least a batch aims at, in seconds: each gate child costs a start of its own. */
const MIN_BATCH_SECONDS = 20;

/** The files Vitest runs at once here, as D17.1's estimate reads them. */
export const runWidth = () => Math.max(1, availableParallelism() - 1);

/** D17.1: the files' estimate from their stored durations, as one Vitest-wide run. */
export function estimateOf(
  files: readonly Pick<KeyedFile, "ref">[],
  durationOf: (ref: TestFileRef) => number | null,
  width = runWidth(),
): RunEstimate {
  return estimateRun("vitest", [{ width, seconds: files.map((f) => durationOf(f.ref)) }]);
}

/** One batch as it ran: its paths and its seconds, its child's start included. */
export interface BatchTime {
  readonly paths: number;
  readonly seconds: number;
}

/**
 * The batches' sizes, in paths. `fixed`: that many paths each (tests).
 * Else the first is the paths whose estimate reaches the batch's aim, or
 * `width` paths with no stored duration. After batches of two sizes, their
 * times give a fixed cost per batch (the child's start, the gate's keying
 * and the runner's start) and a cost per path, by a least-squares line;
 * the next batch aims at the aim, or at four times the fixed cost when
 * that is longer, so the start never costs more than a quarter of a batch.
 * After one size only, the time per path, the start included.
 */
export class Batches {
  readonly #aim: number;
  readonly #width: number;
  readonly #fixed: number | undefined;
  readonly #ran: BatchTime[] = [];

  constructor(budgetSeconds: number, options: { width?: number; fixed?: number } = {}) {
    this.#aim = Math.max(MIN_BATCH_SECONDS, budgetSeconds * BATCH_SHARE);
    this.#width = options.width ?? runWidth();
    this.#fixed = options.fixed;
  }

  /** The next batch from `left`, whole paths in order; `left` minus it is what stays. */
  next(left: readonly RelativePath[], secondsOf: (path: RelativePath) => number | null): number {
    if (left.length === 0) return 0;
    if (this.#fixed !== undefined) return Math.min(left.length, Math.max(1, this.#fixed));
    const cost = costOf(this.#ran);
    if (cost !== null) {
      const aim = Math.max(this.#aim, 4 * cost.start);
      const n = Math.floor((aim - cost.start) / Math.max(cost.perPath, 0.001));
      return Math.min(left.length, Math.max(1, n));
    }
    const known = left.map(secondsOf);
    if (known.every((s) => s === null)) return Math.min(left.length, this.#width);
    let held = 0;
    let n = 0;
    const middle = known.filter((s): s is number => s !== null).sort((a, b) => a - b);
    const typical = middle[Math.floor(middle.length / 2)] ?? 0;
    while (n < left.length && held < this.#aim) {
      held += (known[n] ?? typical) / this.#width;
      n++;
    }
    return Math.max(1, n);
  }

  /** A batch of `paths` paths took `seconds` here, its child's start included. */
  took(paths: number, seconds: number): void {
    this.#ran.push({ paths, seconds });
  }

  /** The batches so far, in order. */
  ran(): readonly BatchTime[] {
    return [...this.#ran];
  }
}

/**
 * A batch's fixed cost and its cost per path from the batches so far:
 * the least-squares line through (paths, seconds) when they hold two
 * sizes and its slope is above 0; else no fixed cost and the mean time
 * per path; `null` before any batch.
 */
export function costOf(
  ran: readonly BatchTime[],
): { readonly start: number; readonly perPath: number } | null {
  if (ran.length === 0) return null;
  const paths = ran.reduce((sum, b) => sum + b.paths, 0);
  const seconds = ran.reduce((sum, b) => sum + b.seconds, 0);
  const mean = { start: 0, perPath: seconds / Math.max(1, paths) };
  const mx = paths / ran.length;
  const my = seconds / ran.length;
  const sxx = ran.reduce((sum, b) => sum + (b.paths - mx) ** 2, 0);
  if (sxx === 0) return mean;
  const slope = ran.reduce((sum, b) => sum + (b.paths - mx) * (b.seconds - my), 0) / sxx;
  if (slope <= 0) return mean;
  const start = Math.min(Math.max(0, my - slope * mx), Math.min(...ran.map((b) => b.seconds)));
  return { start, perPath: slope };
}

/**
 * P3: whether `--run` tells the estimate before it runs: always with
 * `--all-missing`; else when the selection is large for this machine and
 * budget: more files than run at once with no stored duration, or an
 * estimate over half the budget left.
 */
export function tellsEstimate(estimate: RunEstimate, allMissing: boolean, left: number): boolean {
  if (allMissing) return true;
  if (estimate.seconds === null) return estimate.files > estimate.width;
  return estimate.seconds * 2 > left;
}

/** The words of the call's rerun, by `rerunCommand`. */
export interface RunCall {
  readonly given: string;
  readonly paths: readonly string[];
  readonly allMissing: boolean;
}

/** D4.5, D17.1 (P3): the estimate line, told before the run; how to narrow it unless every file is asked. */
export function estimateText(
  estimate: RunEstimate,
  commit: string,
  budget: number,
  call: RunCall,
): string {
  const { files, seconds, known, width } = estimate;
  const at = commit.slice(0, 9);
  const flag = call.allMissing ? "--all-missing" : "--run";
  if (files === 0) return `${flag}: no test file with no result at ${at}`;
  const what = `${files} test file${files === 1 ? "" : "s"} with no result at ${at} to run, up to ${width} at once`;
  const budgetText = `the budget is ${budget} s, the checkout and install included`;
  const narrow = call.allMissing
    ? ""
    : `; to narrow it, name test files or folders: squeal status --at ${shellWord(call.given)} <path>... --run`;
  if (seconds === null)
    return `${flag}: ${what}; no stored duration, so the time is unknown; ${budgetText}${narrow}`;
  const from =
    known < files
      ? `the stored durations of ${known} (the others at their median)`
      : files === 1
        ? "its stored duration"
        : "their stored durations";
  return `${flag}: ${what}: about ${seconds} s from ${from}; ${budgetText}${narrow}`;
}

/**
 * P3: of the time left, what the parent keeps between the gate's own
 * budget and its hard stop, for the gate to stop, keep what completed
 * and answer: a tenth of it, at least 5 s and at most 60 s.
 */
export function stopMargin(leftSeconds: number): number {
  return Math.min(60, Math.max(5, Math.ceil(leftSeconds / 10)));
}
