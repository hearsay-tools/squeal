import { compare } from "../../fs/compare.js";
import { testFileId } from "../../keys/reverse-index.js";
import { describeHolders, refusedLockHolders } from "../../store/lock-holders.js";
import type { AbsolutePath, EpochMs } from "../../types/common.js";
import type { RunReport } from "../../types/runner.js";
import { again, completed, type Kept, notKept } from "./keep-write.js";

/*
 * Spec 020 D17.5 as amended by row 020-67 (#220): how long the keeper's
 * last pass waits for a busy store. The bound counts only time with no
 * landed write: each write that lands starts it again, so a store that is
 * free often never spends it. A ceiling stops the wait in all: the time
 * the queued files took to run in this gate, never less than the bound,
 * as waiting longer would cost more than running them again. The lines
 * name which limit stopped the wait.
 */

/** D17.5: how long the keeper waits with no write landing on a busy store. */
export const KEEP_BUSY_BOUND_MS = 30_000;

/** How many file names a note lists before it counts the rest. */
const NAMED = 5;

/** Which limit stopped a wait: no write landed for the bound, or the ceiling in all. */
export type WaitStop = "quiet" | "ceiling";

/**
 * D17.5's one wait over the keeper's writes: started by the first write a
 * busy store refused, told once then. It stops when no write landed for
 * `boundMs`, or `ceiling` after it started (row 020-67).
 */
export class StoreWait {
  readonly #options: StoreWaitOptions;
  /** When the first write was refused. */
  #since: EpochMs | null = null;
  /** When the last write landed, or the first was refused: the bound counts from it. */
  #quiet: EpochMs | null = null;
  #ceilingMs = 0;
  #stop: WaitStop | null = null;
  #database: AbsolutePath | null = null;

  constructor(options: StoreWaitOptions) {
    this.#options = options;
  }

  /** Whether a busy store refused a write: from then on, each file's inputs are read again before its writes. */
  get waited(): boolean {
    return this.#since !== null;
  }

  /** Which limit stopped the wait, once `giveUp` said so. */
  get stop(): WaitStop | null {
    return this.#stop;
  }

  /**
   * Asked after each try that `database` refused as busy: whether the
   * wait is over. The first names the files of `left` and the lock's
   * holder before the wait, and sets the ceiling from `left`'s run time.
   */
  giveUp(database: AbsolutePath, left: readonly Kept[]): boolean {
    const { now, boundMs } = this.#options;
    this.#database = database;
    if (this.#since === null) this.#start(database, left);
    const at = now();
    if (at - (this.#quiet ?? at) >= boundMs) this.#stop = "quiet";
    else if (at - (this.#since ?? at) >= this.#ceilingMs) this.#stop = "ceiling";
    return this.#stop !== null;
  }

  /** A write landed: after a refusal, the bound counts again from now (row 020-67). */
  landed(): void {
    if (this.#since !== null) this.#quiet = this.#options.now();
  }

  /**
   * The note once every file was written or left out, after a wait only:
   * how long it took when a write landed after it (`freed`), how many
   * files were kept, and how many were not because their inputs moved
   * during it, which the next run runs again.
   */
  done(counts: {
    readonly written: number;
    readonly changed: number;
    readonly freed: boolean;
  }): void {
    const { now, tell } = this.#options;
    const { written, changed, freed } = counts;
    if (this.#since === null) return;
    const moved = changed === 0 ? null : `${changed} changed during the wait, so ${again(changed)}`;
    if (freed) {
      const free = `the store was free after ${seconds(now() - this.#since)} s: ${completed(written)} kept`;
      tell(moved === null ? free : `${free}; ${moved}`);
    } else if (changed > 0) {
      tell(
        `${notKept(changed)}: ${changed === 1 ? "it" : "they"} changed during the wait; ${again(changed)}`,
      );
    }
  }

  /**
   * The note when the wait stopped with `left` files not written,
   * `changed` of them because their inputs moved: which limit stopped it.
   */
  spent(left: number, changed: number): string {
    const busy = this.#database === null ? "" : ` (${holderOf(this.#database)})`;
    const moved = changed === 0 ? "" : `, and ${changed} of them changed during the wait`;
    const why =
      this.#stop === "ceiling"
        ? `the store was still busy after ${seconds(this.#ceilingMs)} s${busy}, and waiting longer would cost more than running ${left === 1 ? "it" : "them"} again`
        : `no write landed for ${seconds(this.#options.boundMs)} s${busy}`;
    return `${notKept(left)}: ${why}${moved}; ${again(left)}`;
  }

  #start(database: AbsolutePath, left: readonly Kept[]): void {
    const { now, boundMs, tell, runMs } = this.#options;
    this.#since = now();
    this.#quiet = this.#since;
    this.#ceilingMs = Math.max(boundMs, runMs?.(left) ?? 0);
    // Row 020-59: the files earlier passes wrote while the runs went on are named apart.
    const { keptEarly = 0 } = this.#options;
    const early = keptEarly === 0 ? "" : ` (${keptEarly} kept while the runs went on)`;
    const limits = `until no write lands for ${seconds(boundMs)} s, at most ${seconds(this.#ceilingMs)} s in all`;
    const wait = `waiting to keep ${completed(left.length)}${early} ${limits}`;
    tell(`the store is busy (${holderOf(database)}); ${wait}: ${names(left)}`);
  }
}

export interface StoreWaitOptions {
  readonly now: () => EpochMs;
  /** How long the wait lasts with no write landing. */
  readonly boundMs: number;
  readonly tell: (text: string) => void;
  /** Row 020-59: how many files were written before this wait's pass, while the runs went on. */
  readonly keptEarly?: number;
  /**
   * Row 020-67: how long `files` took to run in this gate; the wait's
   * ceiling, never less than `boundMs`. Absent: the ceiling is `boundMs`.
   */
  readonly runMs?: (files: readonly Kept[]) => number;
}

/** One run's report and the files it queued, as `runTime` reads them. */
export interface RanFiles {
  readonly files: readonly Kept[];
  readonly report: Pick<RunReport, "durationMs" | "fileDurations">;
}

/**
 * Row 020-67: how long the files a `runMs` call names took to run in this
 * gate, as the wait's ceiling. Per run: the sum of their own durations,
 * never more than the run's; the run's whole duration when one of them
 * has none. Summed over the runs, which may have run at once, so it is an
 * upper bound of what running them again would take.
 */
export function runTime(runs: readonly RanFiles[]): (files: readonly Kept[]) => number {
  const runOf = new Map<Kept, RanFiles>();
  for (const run of runs) for (const file of run.files) runOf.set(file, run);
  return (files) => {
    const byRun = new Map<RanFiles, Kept[]>();
    for (const file of files) {
      const run = runOf.get(file);
      if (run !== undefined) byRun.set(run, [...(byRun.get(run) ?? []), file]);
    }
    let total = 0;
    for (const [run, left] of byRun) total += runShare(run, left);
    return total;
  };
}

/** What `left` of `run`'s files took: their summed durations, at most the run's. */
function runShare(run: RanFiles, left: readonly Kept[]): number {
  const { durationMs, fileDurations = [] } = run.report;
  const own = new Map(fileDurations.map((d) => [testFileId(d.testFile), d.durationMs]));
  let sum = 0;
  for (const file of left) {
    const ms = own.get(testFileId(file.ref));
    if (ms === undefined) return durationMs;
    sum += ms;
  }
  return Math.min(sum, durationMs);
}

/**
 * Spec 021 D5: who holds `database`'s write lock, read from `/proc` only.
 * It opens no descriptor of the store's files, so this process's own locks
 * on them stay (the store's coordinator, 2026-11-12). Asked only after the
 * store refused a write, outside any transaction, so a read that names no
 * holder is read again (`refusedLockHolders`, row 020-37).
 */
function holderOf(database: AbsolutePath): string {
  return describeHolders(refusedLockHolders(database));
}

/** The paths of `files` in order, the first `NAMED` of them, then how many more. */
function names(files: readonly Kept[]): string {
  const shown = files
    .map((f) => f.ref.path)
    .sort(compare)
    .slice(0, NAMED);
  const more = files.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}

function seconds(ms: number): number {
  return Number((ms / 1000).toFixed(1));
}
