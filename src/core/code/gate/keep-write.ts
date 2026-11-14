import { setTimeout as sleep } from "node:timers/promises";
import type { FileDecision } from "../../run-evidence/run-evidence.js";
import { checkId } from "../../scheduler/files.js";
import type { WorktreeKeys } from "../../scheduler/keying.js";
import { recordsForFile } from "../../scheduler/records.js";
import { describeFailure } from "../../state/fingerprint.js";
import { busyBackoffMs } from "../../store/busy.js";
import { storePaths } from "../../store/paths.js";
import type { AbsolutePath } from "../../types/common.js";
import type { RunReport } from "../../types/runner.js";
import type { Store } from "../../types/store.js";
import type { Provenance, ResultRecord } from "../../types/store-records.js";
import type { CoverageRecord } from "../coverage/types.js";
import { codeStorePath } from "../store/open.js";
import type { Expected } from "./keep-expected.js";
import type { Seen } from "./keep-seen.js";

/*
 * Spec 020 D17.5 (row 020-28, #192): how the keeper writes its files once
 * the report is out. Each write is one short transaction, tried again in
 * busy slices as `slicedWrite` tries it, never held across an await. How
 * long a busy store is waited for, and its lines, are `StoreWait`'s
 * (`keep-wait.ts`); each write that lands tells it (row 020-67). After
 * every busy pause, and before each write once the store was busy, the
 * file's inputs are read again; a file whose bytes moved is not kept
 * (review 0.1.444 B2).
 */

/** A completed file that may be written. */
export interface Kept extends Expected {
  readonly record: CoverageRecord;
  /**
   * Row 020-39: its store decision when it is kept at the key with what
   * its run read (`atStoreKey`): written once its writer merged the runs'
   * reads, the keeper where no daemon serves or a serving daemon (row
   * 020-48), else told as not kept for it.
   */
  readonly grown?: Pick<FileDecision, "cause" | "reason">;
}

/** What became of one file: written, not written once the bound was spent, or not written because its inputs moved. */
export type KeepOutcome = "kept" | "spent" | "changed";

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
  /**
   * Row 020-39: the runs' reads merged into the shared observed rows
   * (`mergeSeen`); row 020-48, by a serving daemon too, which throws
   * `OlderDaemon` when it is one before that row.
   */
  seen?(seen: readonly Seen[]): Promise<Tried>;
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
  #lost = false;

  /** Whether a try failed, so every later write reads its file's inputs first. */
  get owed(): boolean {
    return this.#owed;
  }

  /** Whether a daemon never received a try: a moved file is then told as moved after it. */
  get lost(): boolean {
    return this.#lost;
  }

  /** A try did not land: a busy store refused it, or (`busy` false) a daemon never received it. */
  owe(busy = true): void {
    this.#owed = true;
    this.#lost ||= !busy;
  }

  /** Whether the file whose inputs `read` reads may be written now; it reads them once owed. */
  async holds(read: () => Promise<boolean>): Promise<boolean> {
    return !this.#owed || read();
  }
}

/**
 * One file's record at its key, then its results there, as the daemon's
 * tier record stores them, each try by `writer`. `giveUp`, asked with the
 * database after each busy pause, says whether the wait is over; `landed`
 * hears each write that landed. Before
 * each write and after every pause, `check` decides whether the file's
 * inputs still hold the bytes its run read, reading them with `steady`.
 * Before every try, the first one and the results write after the coverage
 * write included, `unheld` says whether no merge holds a path of the file
 * (011 C9; review 0.1.458 B4), as the daemon's record reads its hold at
 * each try (`TierRecords.#heldNow`); a held file is not written, and is
 * counted as one whose inputs moved. All are asked outside any
 * transaction. `store` is read for the file's previous checks.
 */
export async function keepFile(
  stores: { readonly store: Store; readonly keys: WorktreeKeys; readonly writer: KeepWriter },
  at: {
    readonly file: Kept;
    readonly report: RunReport;
    readonly provenance: Provenance;
    readonly databases: ReturnType<typeof databasesOf>;
    readonly giveUp: (database: AbsolutePath) => boolean;
    /** Told after each of the file's writes that landed (row 020-67). */
    readonly landed?: () => void;
    readonly check: InputCheck;
    /** Reads the file's inputs again: whether they hold the bytes its run read. */
    readonly steady: () => Promise<boolean>;
    /** Reads the merge hold again: whether no merge holds a path of the file. */
    readonly unheld: () => Promise<boolean>;
  },
): Promise<KeepOutcome> {
  const { store, keys, writer } = stores;
  const { file, report, provenance, databases, giveUp, check } = at;
  const steady = async () => (await at.unheld()) && (await check.holds(at.steady));
  const paused = (database: AbsolutePath) => async (busy: boolean) => {
    check.owe(busy);
    if (busy && giveUp(database)) return "spent";
    return (await steady()) ? null : "changed";
  };
  if (!(await steady())) return "changed";
  const coded = await sliced(() => writer.coverage(file), paused(databases.code));
  if (coded !== "kept") return coded;
  at.landed?.();
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
  const stored = await sliced(() => writer.results(file, records, keys), paused(databases.main));
  if (stored === "kept") at.landed?.();
  return stored;
}

/**
 * `attempt`, one try of one write, tried as `slicedWrite` tries it: each
 * try waits at most `BUSY_SLICE_MS` for a busy store, the next follows
 * `busyBackoffMs` later. After each pause `paused`, which may read files,
 * says whether to stop; it runs outside any transaction, and counts the
 * bound only after a busy store's refusal. A try a daemon proved never ran
 * is tried again after the same pause, at most `LOST_TRIES` times.
 */
export async function sliced(
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

/**
 * Row 020-68 (#220): the line after the keeper's last pass, when a run
 * completed a file: how many of the `completed` files are `kept`, `early`
 * of them while the runs went on, and what the next run on the same bytes
 * runs.
 */
export function keptCount(counts: {
  readonly kept: number;
  readonly completed: number;
  readonly early: number;
}): string {
  const { completed: all, early } = counts;
  const kept = Math.min(counts.kept, all);
  const during = early === 0 ? "" : ` (${early} while the runs went on)`;
  if (kept === all) {
    const these =
      all === 1 ? "the 1 completed test file is" : `all ${all} completed test files are`;
    const reads = `reads ${all === 1 ? "it" : "them"} from the stores`;
    return `${these} kept in the stores${during}; the next run on the same bytes ${reads}`;
  }
  const rest = all - kept;
  const runs =
    kept === 0 ? (rest === 1 ? "runs it" : `runs all ${rest}`) : `runs the other ${rest}`;
  const are = kept === 1 ? "is" : "are";
  return `${kept} of ${all} completed test files ${are} kept in the stores${during}; the next run on the same bytes ${runs}`;
}

export function completed(count: number): string {
  return `${count} completed test ${count === 1 ? "file" : "files"}`;
}

export function again(count: number): string {
  return `the next run will run ${count === 1 ? "it" : "them"} again`;
}
