import { setTimeout as sleep } from "node:timers/promises";
import { compare } from "../../fs/compare.js";
import { checkId } from "../../scheduler/files.js";
import type { WorktreeKeys } from "../../scheduler/keying.js";
import { recordsForFile } from "../../scheduler/records.js";
import { describeFailure } from "../../state/fingerprint.js";
import { busyBackoffMs } from "../../store/busy.js";
import { describeHolders, refusedLockHolders } from "../../store/lock-holders.js";
import { storePaths } from "../../store/paths.js";
import type { AbsolutePath, EpochMs } from "../../types/common.js";
import type { RunReport } from "../../types/runner.js";
import type { Store } from "../../types/store.js";
import type { Provenance, ResultRecord } from "../../types/store-records.js";
import type { CoverageRecord } from "../coverage/types.js";
import { codeStorePath } from "../store/open.js";
import type { Expected } from "./keep-expected.js";

/*
 * Spec 020 D17.5 (row 020-28, #192): how the keeper writes its files once
 * the report is out. Each write is one short transaction, tried again in
 * busy slices as `slicedWrite` tries it, never held across an await. One
 * bound counts from the first write a busy store refused; stderr names the
 * files that wait and the process that holds the write lock (spec 021 D5)
 * before the wait, and what was not kept when the bound runs out. After
 * every busy pause, and before each write once the store was busy, the
 * file's inputs are read again; a file whose bytes moved is not kept
 * (review 0.1.444 B2).
 */

/** D17.5: how long the keeper waits for a busy store, from the first write it refused. */
export const KEEP_BUSY_BOUND_MS = 30_000;

/** A completed file that may be written. */
export interface Kept extends Expected {
  readonly record: CoverageRecord;
}

/** What became of one file: written, not written once the bound was spent, or not written because its inputs moved. */
export type KeepOutcome = "kept" | "spent" | "changed";

/** How many file names a note lists before it counts the rest. */
const NAMED = 5;

/**
 * D17.5's one wait over the keeper's writes: started by the first write a
 * busy store refused, told once then, and spent `boundMs` later.
 */
export class StoreWait {
  readonly #options: StoreWaitOptions;
  #since: EpochMs | null = null;
  #database: AbsolutePath | null = null;

  constructor(options: StoreWaitOptions) {
    this.#options = options;
  }

  /** Whether a busy store refused a write: from then on, each file's inputs are read again before its writes. */
  get waited(): boolean {
    return this.#since !== null;
  }

  /**
   * Asked after each try that `database` refused as busy: whether the
   * bound is spent. The first names the files of `left` and the lock's
   * holder before the wait.
   */
  giveUp(database: AbsolutePath, left: readonly Kept[]): boolean {
    const { now, boundMs, tell } = this.#options;
    this.#database = database;
    if (this.#since === null) {
      this.#since = now();
      const wait = `waiting up to ${seconds(boundMs)} s to keep ${completed(left.length)}`;
      tell(`the store is busy (${holderOf(database)}); ${wait}: ${names(left)}`);
    }
    return now() - this.#since >= boundMs;
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

  /** The note when the bound ran out with `left` files not written, `changed` of them because their inputs moved. */
  spent(left: number, changed: number): string {
    const busy = this.#database === null ? "" : ` (${holderOf(this.#database)})`;
    const moved = changed === 0 ? "" : `, and ${changed} of them changed during the wait`;
    return `${notKept(left)}: the store stayed busy for ${seconds(this.#options.boundMs)} s${busy}${moved}; ${again(left)}`;
  }
}

export interface StoreWaitOptions {
  readonly now: () => EpochMs;
  readonly boundMs: number;
  readonly tell: (text: string) => void;
}

/** The databases a file's write touches, as `lockHolders` reads them. */
export function databasesOf(commonDir: AbsolutePath): {
  readonly main: AbsolutePath;
  readonly code: AbsolutePath;
} {
  return { main: storePaths(commonDir).database, code: codeStorePath(commonDir) };
}

/**
 * How one try of a write ended: written; refused by a busy store; or, sent
 * to a daemon, proved never to have run (review 0.1.450 B2), so another
 * try is a new write.
 */
export type Tried = "kept" | "busy" | "lost";

/** How many lost tries of one write are tried again before the write fails. */
const LOST_TRIES = 3;

/**
 * One try of each write of a kept file. Here (`writeHere`), or through the
 * daemon that serves the worktree (`writeThroughDaemon`, spec 021 D15, row
 * 021-20).
 */
export interface KeepWriter {
  /** The file's coverage record at its key (`putParts`). */
  coverage(file: Kept): Promise<Tried>;
  /** The file's results in one transaction (`storeResults`), `keys` its lookup's. */
  results(file: Kept, records: readonly ResultRecord[], keys: WorktreeKeys): Promise<Tried>;
}

/**
 * Spec 020 D17.5, review 0.1.450 R1-B2: the one input check every new
 * write of a kept file passes first (`keepFile`). Until a try fails, the
 * opening check of `flush` holds. From the first try that did not land on,
 * whether a busy store refused it or a daemon never received it, each
 * file's inputs are read again before each of its writes and after every
 * pause, for every file still to write. It is not the busy clock
 * (`StoreWait`): a lost try owes the check and starts no wait.
 */
export class InputCheck {
  #owed = false;

  /** Whether a try failed, so every later write reads its file's inputs first. */
  get owed(): boolean {
    return this.#owed;
  }

  /** A try did not land. */
  owe(): void {
    this.#owed = true;
  }

  /** Whether the file whose inputs `read` reads may be written now; it reads them once owed. */
  async holds(read: () => Promise<boolean>): Promise<boolean> {
    return !this.#owed || read();
  }
}

/**
 * One file's record at its key, then its results there, as the daemon's
 * tier record stores them, each try by `writer`. `giveUp`, asked with the
 * database after each busy pause, says whether the bound is spent. Before
 * each write and after every pause, `check` decides whether the file's
 * inputs still hold the bytes its run read, reading them with `steady`.
 * All are asked outside any transaction. `store` is read for the file's
 * previous checks.
 */
export async function keepFile(
  stores: { readonly store: Store; readonly keys: WorktreeKeys; readonly writer: KeepWriter },
  at: {
    readonly file: Kept;
    readonly report: RunReport;
    readonly provenance: Provenance;
    readonly databases: ReturnType<typeof databasesOf>;
    readonly giveUp: (database: AbsolutePath) => boolean;
    readonly check: InputCheck;
    /** Reads the file's inputs again: whether they hold the bytes its run read. */
    readonly steady: () => Promise<boolean>;
  },
): Promise<KeepOutcome> {
  const { store, keys, writer } = stores;
  const { file, report, provenance, databases, giveUp, check } = at;
  const steady = () => check.holds(at.steady);
  const paused = (database: AbsolutePath) => async (busy: boolean) => {
    check.owe();
    if (busy && giveUp(database)) return "spent";
    return (await steady()) ? null : "changed";
  };
  if (!(await steady())) return "changed";
  const coded = await sliced(() => writer.coverage(file), paused(databases.code));
  if (coded !== "kept") return coded;
  // D8's file-level error expansion: the checks of the file's newest stored key, from any worktree.
  const previous = new Map(
    store.results.newestForTestFile(file.ref).map((r) => [checkId(r.check), r.check]),
  );
  const records = recordsForFile({
    ref: file.ref,
    key: file.key,
    report,
    previousChecks: [...previous.values()],
    provenance,
    describe: describeFailure,
  });
  // A record no results follow is never read (`Keeper.#write`), and prune removes it.
  if (!(await steady())) return "changed";
  return sliced(() => writer.results(file, records, keys), paused(databases.main));
}

/**
 * `attempt`, one try of one write, tried as `slicedWrite` tries it: each
 * try waits at most `BUSY_SLICE_MS` for a busy store, the next follows
 * `busyBackoffMs` later. After each pause `paused`, which may read files,
 * says whether to stop; it runs outside any transaction, and counts the
 * bound only after a busy store's refusal. A try a daemon proved never ran
 * is tried again after the same pause, at most `LOST_TRIES` times.
 */
async function sliced(
  attempt: () => Promise<Tried>,
  paused: (busy: boolean) => Promise<Exclude<KeepOutcome, "kept"> | null>,
): Promise<KeepOutcome> {
  let lost = 0;
  for (let n = 0; ; n++) {
    const tried = await attempt();
    if (tried === "kept") return "kept";
    if (tried === "lost" && ++lost > LOST_TRIES) {
      throw new Error(`the daemon lost ${lost} tries of a write before they ran`);
    }
    await sleep(busyBackoffMs(n));
    const stop = await paused(tried === "busy");
    if (stop !== null) return stop;
  }
}

/**
 * Review 0.1.450 B2: the note when the daemon did not say whether it kept
 * the first of `left` files (`why`), and wrote none of the others.
 */
export function perhapsKept(left: number, why: string): string {
  const first = `whether the daemon kept the first of them is not known (${why})`;
  if (left === 1) {
    return `1 completed test file may not be kept in the stores: whether the daemon kept it is not known (${why}); the next run reads it if it was kept, else runs it again`;
  }
  return `${completed(left)} may not be kept in the stores: ${first}, and the other ${left - 1} were not written; the next run reads what was kept and runs the rest again`;
}

/** The start of a note on `count` completed test files that were not kept. */
export function notKept(count: number): string {
  return `${completed(count)} ${count === 1 ? "was" : "were"} not kept in the stores`;
}

/**
 * Review 0.1.450 R1-B2: the note on `count` files not kept because their
 * inputs moved after a try the daemon never received, with no busy wait.
 */
export function changedAfterLoss(count: number): string {
  const they = count === 1 ? "it" : "they";
  return `${notKept(count)}: ${they} changed after a write the daemon never received; ${again(count)}`;
}

function completed(count: number): string {
  return `${count} completed test ${count === 1 ? "file" : "files"}`;
}

function again(count: number): string {
  return `the next run will run ${count === 1 ? "it" : "them"} again`;
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
