import {
  mergeHeld,
  type RecordOutcome,
  readRecordEvidence,
  recordOutcome,
  unstableInputs,
} from "../run-evidence/run-evidence.js";
import { isBusy } from "../store/connection.js";
import { plural } from "../text.js";
import type { RelativePath } from "../types/common.js";
import type { RunReport } from "../types/runner.js";
import type { BusyResume } from "./busy-resume.js";
import type { SchedulerContext } from "./context.js";
import { recordFocusedTier } from "./focused-record.js";
import type { MergeHold } from "./hold.js";
import type { InstallStamps } from "./install-stamp.js";
import { interruptedFiles } from "./interrupted.js";
import type { Ledger } from "./ledger.js";
import type { Mutex } from "./mutex.js";
import type { TierObservations } from "./observed.js";
import { type HeldSetups, heldSetups } from "./setup.js";
import { SlotRecords } from "./slot-records.js";
import type { SlowRun } from "./slow-tier.js";
import { type Moved, Withholds, withholdNote } from "./stability.js";
import { recordTier, type Tier, type TierFile, unfinishedFiles } from "./tiers.js";
import type { WarmUp } from "./warm-up.js";
import type { TierYields } from "./yields.js";

/** A run that ended, with what its record reads outside the lock. */
interface EndedRun {
  readonly tier: Tier;
  readonly ran: RunReport;
  readonly ignored: Awaited<ReturnType<WarmUp["read"]>>;
  readonly inputs: Moved;
  readonly installMoved: boolean;
  /** The daemon's own runtime went (row 011-106): the run stores nothing. */
  readonly runtimeGone: boolean;
  readonly slow: SlowRun | null;
  /** A command hold cancelled it (row 011-74): what it cut short queues again. */
  readonly held: boolean;
}

/**
 * What a record decides under the lock before its write (row 011-126): kept
 * while a busy store holds the write back, so a retry does not re-key
 * again. The merge hold is read again at each try (review 0.1.273, B1), and
 * so is the completion barrier over the files it leaves free, whose
 * withholds count once the write lands (row 011-128).
 */
interface PreparedRecord {
  readonly changed: ReadonlySet<RelativePath>;
  readonly touched: readonly RelativePath[];
  readonly observed: TierObservations | undefined;
  /** The files a cancel cut short: queued again instead of stored whatever the hold. */
  readonly unfinished: readonly string[];
  /** The files and setups the merge hold held at the preparation: still held at each try. */
  readonly held: readonly TierFile[];
  readonly setupsHeld: HeldSetups<TierFile>;
  /** The stop's cancel had reached the run. */
  readonly cancelled: boolean;
}

/** What a record leaves to do outside the lock: the paths to reconcile, the withhold notes. */
export interface Recorded {
  readonly moved: readonly RelativePath[];
  readonly withheld: readonly string[];
}

/** What the records of ended runs use of their scheduler (row 011-131). */
export interface RecordHost {
  readonly lock: Mutex;
  started(): { context: SchedulerContext; ledger: Ledger };
  /** The pump's resume after a busy store (task 001-422); `null` without `busyWaits`. */
  readonly busy: BusyResume | null;
  readonly hold: MergeHold;
  readonly warmUp: WarmUp;
  readonly yields: TierYields;
  readonly install: InstallStamps;
  /** Aborted by a `squeal stop`'s close (D10, task 001-367). */
  readonly stop: AbortSignal;
  /** `fn` with each write it awaits waiting at most the busy slice (row 011-126). */
  sliced<T>(fn: () => Promise<T>): Promise<T>;
  closed(): boolean;
  /** The close began, or the daemon's stop (row 011-66). */
  stopping(): boolean;
  /** The install went under the scheduler (task 001-113). */
  reinstalled(): boolean;
  runtimeMissing(): Promise<boolean>;
  /** A slow tier recorded (spec 004 D8). */
  slowEnded(): void;
}

/**
 * The records of the runs that ended: what each loaded and read beyond its
 * keys, the merge hold's and the completion barrier's withholds, then
 * `recordTier`, in one write transaction under the lock. A backlog slot's
 * joins the other slots that ended by then (`SlotRecords`, task 011-21
 * slice 2).
 */
export class TierRecords {
  readonly #host: RecordHost;
  /** Task 007-30: files the completion barrier withheld, so a withheld tier runs once more. */
  readonly #withholds = new Withholds();
  /** The records of backlog slots, each with the slots that end meanwhile (task 011-21 slice 2). */
  readonly #slots: SlotRecords<EndedRun, Recorded>;
  /** The busy store's error a slot's record gave up on, since its record began (`#recordSlot`). */
  #slotsBusy: unknown = null;
  /** Row 011-126: each ended run's record as prepared, and as written, kept across tries on a busy store. */
  readonly #prepared = new WeakMap<EndedRun, PreparedRecord>();
  readonly #written = new WeakMap<EndedRun, Recorded>();

  constructor(host: RecordHost) {
    this.#host = host;
    this.#slots = new SlotRecords<EndedRun, Recorded>({
      lock: host.lock,
      record: (ended) => this.#recordSlot(ended),
      commit: () => host.started().ledger.commit(),
    });
  }

  /**
   * Records `tier`'s run `ran`; `held` aborts when a command hold cancels
   * it. A slot's record joins the slots that ended meanwhile.
   */
  async record(
    tier: Tier,
    ran: RunReport,
    installStamp: string,
    slow: SlowRun | null,
    held: AbortController | null,
  ): Promise<Recorded> {
    // Row 011-145: a focused tier's record stores nothing under a key.
    if (tier.kind === "focused")
      return this.#landed(tier, () => this.#focused(tier, ran, installStamp, held));
    if (tier.slot === true) {
      const ended = this.#ended(tier, ran, installStamp, slow, held);
      return this.#landed(tier, () => {
        this.#slotsBusy = null;
        return this.#slots.record(ended);
      });
    }
    const ended = await this.#ended(tier, ran, installStamp, slow, held);
    return this.#landed(tier, () =>
      this.#host.lock.run(() => this.#record(ended, true), "recording the results of a tier"),
    );
  }

  /**
   * Row 011-126: `attempt`, the record of `tier`'s run, its writes waiting at
   * most the busy slice. One that gives up keeps the run's results and tries
   * again at its turn (`BusyResume`), so a busy store neither holds the event
   * loop nor queues the files to run again. Once the scheduler closes, the
   * last try waits as long as the store does.
   */
  async #landed(tier: Tier, attempt: () => Promise<Recorded>): Promise<Recorded> {
    const { busy } = this.#host;
    for (;;) {
      const last = this.#host.closed();
      try {
        return await (last ? attempt() : this.#host.sliced(attempt));
      } catch (error) {
        if (last || busy === null || !isBusy(error)) throw error;
        await busy.retry(`the results of ${plural(tier.files.length, "file")}`);
      }
    }
  }

  /**
   * A slot's record (`SlotRecords`). Row 011-126: once one slot's write gave
   * up on a busy store, the rest of its record give up without trying, so
   * their slices do not add up; each tries again at its own turn.
   */
  async #recordSlot(ended: EndedRun): Promise<Recorded> {
    if (this.#slotsBusy !== null) throw this.#slotsBusy;
    try {
      return await this.#record(ended, false);
    } catch (error) {
      if (isBusy(error)) this.#slotsBusy = error;
      throw error;
    }
  }

  /**
   * A focused tier's record (C4 as amended 2026-10-23, row 011-145): the
   * stability check and the install's, then the focused meta row (`writeFocused`) and a closed
   * run row under the lock. Its writes are its own: tried again whole on a
   * busy store, and none touches the ledger.
   */
  async #focused(
    tier: Tier,
    ran: RunReport,
    installStamp: string,
    held: AbortController | null,
  ): Promise<Recorded> {
    const host = this.#host;
    const { context } = host.started();
    const inputs = await unstableInputs(tier, context.hasher);
    const installMoved =
      host.reinstalled() ||
      (await host.install.stamp()) !== installStamp ||
      (await host.runtimeMissing());
    const cancelled =
      host.stop.aborted || held?.signal.aborted === true || tier.cancel?.signal.aborted === true;
    return host.lock.run(() => {
      const { context, ledger } = host.started();
      host.yields.ended(context, tier);
      const moved = recordFocusedTier(context, ledger, tier, ran, {
        inputs,
        installMoved,
        cancelled,
      });
      return { moved, withheld: [] };
    }, "recording the results of a focused tier");
  }

  /** What the record of a run that ended reads outside the lock. */
  async #ended(
    tier: Tier,
    ran: RunReport,
    installStamp: string,
    slow: SlowRun | null,
    held: AbortController | null,
  ): Promise<EndedRun> {
    const host = this.#host;
    const { context } = host.started();
    const ignored = await host.warmUp.read(context, tier, ran);
    // The completion barrier (task 001-168): a touch since selection withholds the files keying it.
    const inputs = await unstableInputs(tier, context.hasher);
    const installMoved = host.reinstalled() || (await host.install.stamp()) !== installStamp;
    const runtimeGone = await host.runtimeMissing();
    // Row 011-72: the record reads the index when it moved, so a merge during the run holds its files.
    await host.hold.check();
    const cancelled = held?.signal.aborted === true;
    return { tier, ran, ignored, inputs, installMoved, runtimeGone, slow, held: cancelled };
  }

  /**
   * Records an ended run under the lock: what it loaded and read beyond its
   * keys, the completion barrier's withholds, then `recordTier`. `commit`
   * false leaves the ledger's writes to the caller's commit (`SlotRecords`).
   * Row 011-126: a record tried again after a busy store gave up writes what
   * it prepared the first time, and a slot's whose write landed returns it,
   * owing only the commit.
   */
  async #record(ended: EndedRun, commit: boolean): Promise<Recorded> {
    const written = this.#written.get(ended);
    if (written !== undefined) return written;
    const prepared = this.#prepared.get(ended) ?? (await this.#prepare(ended));
    this.#prepared.set(ended, prepared);
    const recorded = this.#write(ended, prepared, commit);
    this.#written.set(ended, recorded);
    return recorded;
  }

  /** What a record reads and decides under the lock before its write, once however often it is tried. */
  async #prepare(ended: EndedRun): Promise<PreparedRecord> {
    const { hold } = this.#host;
    const { context } = this.#host.started();
    const { tier, ran, inputs, installMoved, held: holdCut } = ended;
    // What the run loaded and read beyond its keys, editor scratch listings, the merge hold. Row
    // 011-72 (011 C9): a held file stores nothing and stays queued; that withhold counts toward
    // no withhold limit.
    const evidence = await readRecordEvidence(context, tier, ran, inputs, installMoved, hold);
    const { changed, touched, observed, held } = evidence;
    // Review 0.1.266, B2: the held files' projects give no setup outcome, and a startup failure
    // that blames one is the hold's: it blocks nothing and the files it kept from starting queue.
    const setupsHeld = heldSetups(hold, tier.files, held, ran.startupFailure);
    // What a stop's cancel cut short stays queued for the next daemon (D10, task 001-367), and
    // what a hold's cancel cut short stays queued for the hold's end (row 011-74).
    const cancelled = this.#host.stop.aborted;
    const unfinished = cancelled || holdCut ? unfinishedFiles(tier, ran) : [];
    return { changed, touched, observed, unfinished, held, setupsHeld, cancelled };
  }

  /**
   * Review 0.1.273, B1 (011 C9): what the merge hold holds as the record's
   * write lands, read again at each try, since a hold can start while a busy
   * store holds the write back. A file or setup held at the preparation stays
   * held.
   */
  #heldNow(ended: EndedRun, prepared: PreparedRecord): HeldSetups<TierFile> & { held: TierFile[] } {
    const { hold } = this.#host;
    const { tier, ran } = ended;
    const { observed, setupsHeld: was } = prepared;
    const now = mergeHeld(hold, tier.files, observed);
    const held = tier.files.filter((f) => prepared.held.includes(f) || now.includes(f));
    const setups = heldSetups(hold, tier.files, held, ran.startupFailure);
    return {
      held,
      projects: new Set([...was.projects, ...setups.projects]),
      startup: was.startup || setups.startup,
      notStarted: tier.files.filter(
        (f) => was.notStarted.includes(f) || setups.notStarted.includes(f),
      ),
    };
  }

  /**
   * The record's one write transaction, from what `#prepare` decided. Its
   * report and requeue are the run evidence's (`recordOutcome`, row
   * 011-319), from the facts of this try: the files the merge hold holds
   * now, the barrier's withholds as `Withholds` splits them, what a cancel
   * cut short, what a held startup kept from starting, what the stop or the
   * runtime's loss interrupted, and the install.
   */
  #write(ended: EndedRun, prepared: PreparedRecord, commit: boolean): Recorded {
    const host = this.#host;
    const { context, ledger } = host.started();
    const { tier, ran, ignored, installMoved, runtimeGone, slow } = ended;
    const { changed, touched, observed, cancelled } = prepared;
    const { held, projects, startup, notStarted } = this.#heldNow(ended, prepared);
    // Spec 004 D8: a slow run's activity goes with its results (review wave 2, B1, B2).
    const { moved, outcome } = context.store.transaction(() => {
      // Rows 011-66 and 011-106: a crash after the daemon's stop began, or a run while its own
      // runtime went, is queued again once per key.
      const interrupted = interruptedFiles(context, ledger, tier, ran, {
        stopping: host.stopping() && !cancelled,
        runtimeGone,
      });
      // Task 007-30: no revision follows a touch; a file's first withhold at its key queues it
      // again as a moved install does, its previous state standing, and a second leaves it
      // `unknown`, per file whatever tier it shares (review 007-31, B1). The exhausted files,
      // forced or not, record the withheld report and are `unknown` in the same commit (review
      // 007-33, B1).
      const outcome = recordOutcome(tier.files, ran, prepared, {
        held,
        startupHeld: startup,
        withholds: (barred) => this.#withholds.peek(barred),
        unfinished: prepared.unfinished,
        notStarted,
        interrupted,
        installMoved,
      });
      // Review 0.1.262, B2: a report the runtime's loss rejects applies no setup outcome either.
      const lost = runtimeGone && interrupted.length > 0;
      const setups = lost ? false : projects.size === 0 || projects;
      host.warmUp.record(context, ignored);
      host.yields.ended(context, tier);
      const { report, requeue } = outcome;
      const result = recordTier(
        context,
        ledger,
        tier,
        report,
        changed,
        requeue,
        observed,
        commit,
        setups,
      );
      if (slow !== null) host.slowEnded();
      // The runner hears the touches too, so its next run reads the disk again.
      return { moved: [...new Set([...result, ...touched])], outcome };
    });
    return { moved, withheld: this.#counted(outcome) };
  }

  /**
   * Once the write has landed, the barrier's withholds count, and their
   * notes. Row 011-128 (011 C9): a held file's withhold counts toward no
   * withhold limit, so only the free files' withholds move.
   */
  #counted(outcome: RecordOutcome): string[] {
    const { barred, free, withheld, paths } = outcome;
    this.#withholds.record(barred);
    this.#withholds.clear(free.filter((ran) => !barred.includes(ran)));
    return [
      withholdNote(paths, withheld.again, true),
      withholdNote(paths, withheld.exhausted, false),
    ].filter((note) => note !== null);
  }
}
