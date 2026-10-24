import { stat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { isMissing } from "../fs/index.js";
import { createFsHasher, readObjectFormat } from "../hash/index.js";
import { appendNote } from "../notes.js";
import { hostLoad } from "../retry/index.js";
import { statCandidates } from "../revision/index.js";
import { describeFailure } from "../state/index.js";
import { isBusy, withBusySlice } from "../store/index.js";
import { plural } from "../text.js";
import {
  type CancelCause,
  type CandidateBatch,
  type ClosureIndex,
  type EpochMs,
  type FullSuiteCheckpoint,
  type FullSuiteRequest,
  isSlowLane,
  type RelativePath,
  type Revision,
  type Scheduler,
  type SchedulerCloseOptions,
  type SchedulerStatus,
  type SlowSuiteRequest,
  type SlowWaiting,
  type TestFileRef,
} from "../types/index.js";
import { reconcileBatch } from "./batch.js";
import { baseline, scan, type UnseenChanges } from "./bootstrap.js";
import { BusyResume } from "./busy-resume.js";
import { CAPACITY_RECHECK_MS, TierCapacity } from "./capacity.js";
import { abandonFullSuite, queueFullSuite } from "./checkpoint-requests.js";
import { claimWake } from "./claims.js";
import { CommandHold } from "./command-hold.js";
import type { SchedulerContext } from "./context.js";
import { NOTHING_CHANGED } from "./context.js";
import { focusedWaiting, mayFocus } from "./focused.js";
import { requeueFocusedTier } from "./focused-record.js";
import { MergeHold } from "./hold.js";
import {
  missingInstall,
  REINSTALL_NOTE,
  reconcileWaiting,
  runtimeGoneNote,
  startWaiting,
  stopWaiting,
  touchesInstall,
} from "./install.js";
import { InstallStamps, refreshInstall } from "./install-stamp.js";
import { WorktreeKeys } from "./keying.js";
import { Ledger } from "./ledger.js";
import { Mutex } from "./mutex.js";
import type { SchedulerOptions } from "./options.js";
import { priorityOf } from "./queue.js";
import { BacklogQuiet, publishQuiet, quietSleepMs } from "./quiet.js";
import { TierRecords } from "./record.js";
import { RERUN_CAP } from "./rerun.js";
import { takeRetries } from "./retries.js";
import { retryRunner } from "./revision.js";
import { RunnerWork } from "./runner-work.js";
import { busyLanes } from "./slots.js";
import { slowView } from "./slow.js";
import { queueSlowSuite, type SlowRun, SlowTier } from "./slow-tier.js";
import { StoredKeys } from "./stored-keys.js";
import {
  cancels,
  endTier,
  executeTier,
  laneOf,
  selectTier,
  supersededIn,
  type Tier,
} from "./tiers.js";
import { WarmUp } from "./warm-up.js";
import { TierYields } from "./yields.js";

/** A tier in flight: its lane is busy until `done` (`busyLanes`), which never rejects. */
interface InFlight {
  readonly tier: Tier;
  done: Promise<void>;
  /** A slot whose run ended: its lane may take the next file while it records (task 011-21). */
  ran: boolean;
  /**
   * Aborted when a command hold begins (row 011-74): a tier whose runner
   * cancels, Vitest's fast or slow; `null` for one that runs to its end.
   */
  readonly held: AbortController | null;
}

/** Creates the scheduler of one worktree. Call `start` before anything else. */
export function createScheduler(options: SchedulerOptions): Scheduler {
  return new TierScheduler(options);
}

class TierScheduler implements Scheduler {
  readonly #lock = new Mutex();
  readonly #idle: (() => void)[] = [];
  readonly #runnerWork = new RunnerWork({
    lock: this.#lock,
    started: () => this.#started(),
    closed: () => this.#closed,
    pump: () => this.#pump(),
    backgroundError: (subject, error) => this.#backgroundError(subject, error),
    applied: () => this.#cutTiers(null),
  });
  readonly #slow: SlowTier;
  #context: SchedulerContext | null = null;
  #ledger: Ledger | null = null;
  #pumping: Promise<void> | null = null;
  /** The runner work being applied beside the tiers in flight (task 001-140). */
  #draining: Promise<void> | null = null;
  /**
   * The tiers in flight by run id: one per lane, or an edit's beside a backlog tier (`busyLanes`,
   * task 011-21); one whose runner cancels carries its `cancel`.
   */
  readonly #inFlight = new Map<string, InFlight>();
  /**
   * Which tiers in flight a revision, a runner part or a promotion cancels (C4 step 5, row 011-51);
   * a tier past its estimate is checked again at its bound (row 011-107).
   */
  readonly #yields = new TierYields(() => this.#recheckTiers());
  /**
   * The lanes that wait for quiet after a backlog tier's cancel, or before an
   * edit's catch-up (C4 step 5, rows 011-82 and 011-153).
   */
  readonly #quiet = new BacklogQuiet((ends, at, catchUp) =>
    publishQuiet(this.options.store, this.options.worktreeId, ends, at, catchUp),
  );
  /** A check of the tiers in flight queued under the lock, not run yet (rows 011-54, 011-107). */
  #recheck = false;
  /** A `run --all` with `observeIgnored` (task 001-307). */
  readonly #warmUp = new WarmUp();
  /** The records of the runs that ended (row 011-131). */
  readonly #records: TierRecords;
  /** Something the pump waits for happened: a tier ended, runner work drained, a batch or request came. */
  #woken = false;
  #wake: (() => void) | null = null;
  /** The pump was asked for while it ran: once stopped on an error, it starts again. */
  #asked = false;
  #closed = false;
  #closing: Promise<void> | null = null;
  /** Aborted by a `squeal stop`'s close: every tier in flight is cancelled (D10, task 001-367). */
  readonly #stop = new AbortController();
  /** The pump stopped on an error; idle until the next batch or request. */
  #stalled = false;
  /** The stall's error was not a busy store's: no busy resume restarts the pump (review 001-432, B1). */
  #failed = false;
  /** No runner call until an install (`awaitsInstall`, task 001-100). */
  #awaitingInstall = false;
  /** Paths no runner saw change: edits the baseline queues recent (review wave 11, S2; `scan`). */
  #waitChanges: UnseenChanges = [];
  /** The install went under this scheduler: it stores nothing more (`#reinstall`, task 001-113). */
  #reinstalled = false;
  #reinstallTold = false;
  /** The daemon's own runtime went (`runtimeDir`, row 011-106): no tier starts, the queue stays. */
  #runtimeGone = false;
  readonly #install: InstallStamps;
  /** The per-user pool's side of this scheduler (spec 001 D11 Capacity); `null` without one. */
  readonly #capacity: TierCapacity | null;
  /** The pump's resume after a busy store (task 001-422); `null` without `busyWaits`. */
  readonly #busy: BusyResume | null;
  /** The keys other worktrees stored since the last read (spec 011 C4 step 3, task 011-23). */
  readonly #storedKeys: StoredKeys;
  /** A departure drain paused the backlog (`pauseBacklog`, row 011-93). */
  #backlogPaused = false;
  /**
   * When `slowWaiting` last found the drain's fast work or a slow file busy,
   * or first checked the drain; `null` until then (row 011-163).
   */
  #drainBusyAt: EpochMs | null = null;
  /** Row 011-72: no tier starts while git lists an unmerged path (011 C9, "Holds"). */
  readonly #hold: MergeHold;
  /** Row 011-74: no tier starts while a `squeal hold` holds (011 C9, "Holds"). */
  readonly #commandHold: CommandHold;

  constructor(private readonly options: SchedulerOptions) {
    this.#install = new InstallStamps(options.root);
    this.#storedKeys = new StoredKeys((options.now ?? Date.now)());
    this.#hold = new MergeHold({
      root: options.root,
      store: options.store,
      worktreeId: options.worktreeId,
      now: options.now ?? Date.now,
      revision: () => this.#ledger?.revision.number ?? 0,
      resumed: () => this.#pump(),
      note: (message) => this.#note(message),
    });
    this.#commandHold = new CommandHold({
      store: options.store,
      worktreeId: options.worktreeId,
      now: options.now ?? Date.now,
      note: (message) => this.#note(message),
      merging: () => this.#hold.holding,
      due: () =>
        void this.commandHold().catch((error: unknown) =>
          this.#backgroundError("could not end a command hold", error),
        ),
    });
    this.#busy =
      options.busyWaits === undefined
        ? null
        : new BusyResume(options.busyWaits, () => {
            // Only a pump a busy store stopped: one a batch restarted, or another error stopped, is not this wait's.
            if (this.#stalled && !this.#failed) this.#pump();
          });
    this.#capacity =
      options.capacity === undefined
        ? null
        : new TierCapacity(options.capacity, options.worktreeId, (message) => this.#note(message));
    this.#slow = new SlowTier(
      {
        lock: this.#lock,
        started: () => this.#started(),
        ready: () => this.#context !== null,
        closed: () => this.#closed,
        halted: () => this.#halted(),
        held: () => this.#onHold(),
        holdCheck: () => this.#holdCheck(),
        runtimeMissing: () => this.#runtimeMissing(),
        pump: () => this.#pump(),
        editPending: () => this.#editPending(),
        fastIdle: () => this.#fastIdle(),
      },
      options.slow,
    );
    this.#records = new TierRecords({
      lock: this.#lock,
      started: () => this.#started(),
      busy: this.#busy,
      hold: this.#hold,
      warmUp: this.#warmUp,
      yields: this.#yields,
      install: this.#install,
      stop: this.#stop.signal,
      sliced: (fn) => this.#sliced(fn),
      closed: () => this.#closed,
      stopping: () => this.#stopping(),
      reinstalled: () => this.#reinstalled,
      runtimeMissing: () => this.#runtimeMissing(),
      slowEnded: () => this.#slow.ended(),
    });
  }

  async start(): Promise<void> {
    await this.#lock.run(async () => {
      if (this.#context) throw new Error("squeal scheduler: started twice");
      const { options } = this;
      const objectFormat = await readObjectFormat(options.root);
      const hasher = options.hasher ?? createFsHasher(options.root, objectFormat);
      const keys = new WorktreeKeys({
        root: options.root,
        worktreeId: options.worktreeId,
        store: options.store,
        hasher,
        objectFormat,
        policy: options.policy,
        squealVersion: options.squealVersion,
        onExtraFiles: (paths) => options.onExtraFiles?.(paths),
        note: (message) => this.#note(message),
        ...(options.env === undefined ? {} : { env: options.env }),
      });
      const context: SchedulerContext = {
        root: options.root,
        worktreeId: options.worktreeId,
        store: options.store,
        runner: options.runner,
        sink: options.sink,
        policy: options.policy,
        reloadPolicy: options.reloadPolicy ?? (() => null),
        keys,
        hasher,
        runsDir: options.runsDir,
        describe: options.describeFailure ?? describeFailure,
        // Each revision's `git status` gives the unmerged paths too (row 011-72).
        head: () => this.#hold.head(options.head),
        // Read at each call: a commit stamps the store's re-key moves with it (`recordMoves`).
        now: options.now ?? (() => Date.now()),
        note: (message) => this.#note(message),
        rerunCap: options.rerunCap ?? RERUN_CAP,
        hostLoad: options.hostLoad ?? hostLoad,
        ...(options.runnerPartMs === undefined ? {} : { runnerPartMs: options.runnerPartMs }),
        ...(options.incarnation === undefined ? {} : { incarnation: options.incarnation }),
        ...(options.predecessor === undefined ? {} : { predecessor: options.predecessor }),
        ...(this.#capacity === null ? {} : { capacity: this.#capacity }),
        quiet: this.#quiet,
      };
      const ledger = new Ledger(context);
      ledger.backlogPaused = this.#backlogPaused;
      // Row 011-72: a key that names an unmerged path takes no stored result.
      ledger.holds = (ref) => this.#hold.holding && this.#hold.names(keys.stabilityPaths(ref));
      // Notes written during the baseline carry its revision.
      this.#ledger = ledger;
      // A daemon starts on hold when git lists an unmerged path or a `squeal hold` holds (011 C9).
      await this.#hold.check(true);
      this.#commandHold.check();
      this.#waitChanges = await scan(context, ledger, options.resumesRest === true);
      // A daemon killed while waiting left its flag (review wave 11, N5); this one decides again.
      stopWaiting(context);
      const missing = await missingInstall(options.root);
      this.#awaitingInstall = missing !== null;
      if (missing !== null) startWaiting(context, ledger, missing);
      else await this.#baseline(context, ledger);
      // A retry an earlier daemon or another worktree's session asked for (001-368).
      if (missing === null && takeRetries(context, ledger)) ledger.commit();
      this.#context = context;
    });
    this.#pump();
  }

  /**
   * Stores the revision a batch creates and returns: the revision row, stat
   * cache, content re-key, `queued` phases and known states, in one
   * transaction. The runner part is queued and applied by the pump beside
   * the tiers in flight, in batch order (`RunnerWork`, task 001-140).
   *
   * Spec 001 D2: "Creating a revision never waits on the runner: the store
   * work [...] completes within the debounce window even while a tier is
   * running, and the runner-dependent refinement is queued separately,
   * applied in revision order beside the tiers in flight [...], and never
   * holds the revision path." Lessons,
   * defect 1: awaiting `runner.invalidate` here, which the runner serializes
   * behind the running tier, let a revision lag the workspace by a whole
   * tier.
   */
  handleBatch(batch: CandidateBatch): Promise<void> {
    return this.#handleBatch(batch, true);
  }

  /**
   * `handleBatch`, the pass `#sliced` when `sliced` (task 001-422): only the
   * change feed's batches, which it retries.
   */
  async #handleBatch(batch: CandidateBatch, sliced: boolean): Promise<void> {
    if (this.#closed || this.#reinstalled) return;
    await this.#lock.run(async () => {
      if (this.#reinstalled) return;
      const { context, ledger } = this.#started();
      // A reconciliation or sync pass reads the index when it moved: `git add` makes no batch (row 011-72).
      if (batch.trigger !== "watch") await this.#hold.check();
      if (this.#awaitingInstall) {
        this.#awaitingInstall = await reconcileWaiting(context, ledger, batch, this.#waitChanges);
        if (!this.#awaitingInstall) await this.#baseline(context, ledger);
        return;
      }
      const pass = () => this.#pass(context, ledger, batch);
      await (sliced ? this.#sliced(pass) : pass());
    });
    if (this.#reinstalled) this.#tellReinstall();
    else this.#pump();
  }

  /** `handleBatch` once the scheduler takes edits: the revision, then its runner work. */
  async #pass(context: SchedulerContext, ledger: Ledger, batch: CandidateBatch): Promise<void> {
    // Another worktree's heal may have left a file held here (review wave 13i, B1).
    if (ledger.confirmHeld()) ledger.commit();
    // Each pass looks again for a load retry's load, and another worktree's requests (001-368).
    if (batch.trigger === "interval" && takeRetries(context, ledger)) ledger.commit();
    this.#adopt(context, ledger);
    const { applied, touched } = await reconcileBatch(context, ledger, batch);
    // Every reconciliation pass looks too: a workspace's `node_modules` is not watched (D5).
    const install = applied?.revision.changes.some((change) => touchesInstall(change.path));
    if (install || batch.trigger === "interval") {
      const { missing } = await this.#install.check();
      // The revision stays unrefined, so the next daemon's `scan` reads its paths as edits.
      if (missing !== null) return this.#reinstall(ledger);
    }
    // Task 001-159: the runner hears of a touched-unchanged file before the next tier.
    if (applied === null) {
      if (touched.length > 0) this.#runnerWork.queueTouched(touched);
      // Task 007-26: a quiet pass rechecks what no watched file shows (a pytest installed set).
      else if (batch.trigger === "interval") this.#runnerWork.queueRecheck();
      return;
    }
    this.#slow.preempt();
    // The runner part waits for the runner: a tier in flight may yield first (C4 step 5, row 011-51).
    this.#cutTiers(applied.revision);
    this.#runnerWork.queueRefine(applied.revision, applied.content, touched);
  }

  /**
   * Spec 011 C4 step 3 as amended (task 011-23): files with no result at
   * their key take what other worktrees stored there since the last read.
   * Not while runner work waits: keys would come from a revision the runner
   * has not invalidated yet, as a tier's would.
   */
  #adopt(context: SchedulerContext, ledger: Ledger): void {
    if (this.#runnerWork.size > 0 || this.#runnerWork.refining) return;
    this.#storedKeys.adopt(context, ledger);
  }

  /**
   * Cancels each tier in flight that `revision`, or with `null` the runner
   * part just applied or a promotion, cuts (`TierYields`, C4 step 5 as
   * amended 2026-10-21, row 011-51; a backlog tier's `cancelsBacklog`, task
   * 001-364).
   */
  #cutTiers(revision: Revision | null): void {
    // Row 011-72: a tier in flight when a hold begins runs to its end; nothing would start instead.
    if (this.#onHold()) return;
    const { context, ledger } = this.#started();
    const tiers = [...this.#inFlight.values()].map(({ tier }) => tier);
    this.#yields.check(context, ledger, tiers, revision);
  }

  /**
   * A file of `tier` ended during its run (row 011-54): once a revision has
   * changed an input of the tier, every file left may now be re-keyed, and
   * once it runs on for a promoted file that ranks with or after its files,
   * the ended file may have ranked first (`named`, review
   * `reviews/0.1.296.md` B1), so the tiers in flight are checked again.
   */
  #fileEnded(tier: Tier): void {
    if (tier.changes.size === 0 && !this.#yields.standsNamed(tier)) return;
    this.#recheckTiers();
  }

  /**
   * Checks the tiers in flight again under the lock, one check queued at a
   * time: after a file's end, at the bound of a tier past its estimate
   * (`TierYields`, row 011-107), or while promoted files wait on claims (row
   * 011-123). Results other worktrees stored are taken first (`#adopt`), as
   * a reconciliation pass does, so a claimant's record cuts nothing.
   */
  #recheckTiers(): void {
    if (this.#recheck) return;
    this.#recheck = true;
    this.#lock
      .run(() => {
        this.#recheck = false;
        if (this.#closed) return;
        // Row 011-123: a claimant's record is taken first, so its file needs no yield.
        const { context, ledger } = this.#started();
        this.#adopt(context, ledger);
        this.#cutTiers(null);
      })
      .catch((error: unknown) =>
        this.#backgroundError("could not check the tiers in flight", error),
      );
  }

  /** The baseline, at start or at the install that ends a wait; the wait ends in the store with it. */
  async #baseline(context: SchedulerContext, ledger: Ledger): Promise<void> {
    stopWaiting(context);
    const unseen = this.#waitChanges;
    this.#waitChanges = [];
    await baseline(context, ledger, unseen, this.options.resumesRest === true);
  }

  /**
   * The install went while the scheduler runs (`npm ci` removes
   * `node_modules` first), at the root or in a workspace: it stores nothing
   * more and its daemon exits, so the next hook's fresh daemon waits for the
   * install with no runner open (task 001-113, review wave 11c B1 and B2). The
   * open checkpoint is abandoned, runner parts not applied yet and the queue
   * are dropped, and the tier in flight records nothing. Under the lock;
   * `#tellReinstall` follows outside it.
   */
  #reinstall(ledger: Ledger): void {
    this.#reinstalled = true;
    this.#runnerWork.dropRefinements();
    ledger.queue.clear();
    ledger.checkpoints.finish("abandoned");
  }

  /** Once: `onReinstall`, or the note itself when no daemon listens. */
  #tellReinstall(note = REINSTALL_NOTE): void {
    if (this.#reinstallTold) return;
    this.#reinstallTold = true;
    if (this.options.onReinstall) this.options.onReinstall(note);
    else this.#note(note);
  }

  /**
   * Row 011-72: the merge hold before a tier, the index read when it moved.
   * A hold that ended released its paths: an abort restored their bytes,
   * and their revision comes before any tier, so no tier runs at the keys
   * of the conflicted bytes.
   */
  async #holdCheck(): Promise<"held" | "released" | "free"> {
    await this.#hold.check();
    const released = this.#hold.takeReleased();
    if (released.length > 0) {
      await this.#reconcilePaths(released);
      return "released";
    }
    return this.#onHold() ? "held" : "free";
  }

  /** Either hold holds (011 C9, "Holds"): no tier starts in any lane, and none is cut. */
  #onHold(): boolean {
    return this.#hold.holding || this.#commandHold.holding;
  }

  async commandHold(): Promise<boolean> {
    if (this.#closed) return false;
    const was = this.#commandHold.holding;
    if (this.#commandHold.check()) {
      // A slow selection waiting for the load guard plans again, and stops on the hold (review 0.1.269, B1).
      this.#slow.preempt();
      await this.#cancelHeld();
      return true;
    }
    if (was) this.#pump();
    return false;
  }

  /**
   * Row 011-74 (011 C9, *Hold command*): cancels each tier in flight whose
   * runner cancels, as the supersession cancel does (C4 step 5); a node:test
   * or pytest slot runs its file to its end. Resolves once those tiers ended.
   */
  async #cancelHeld(): Promise<void> {
    const flights = [...this.#inFlight.values()].filter((flight) => flight.held !== null);
    for (const { held } of flights) held?.abort("hold" satisfies CancelCause);
    await Promise.all(flights.map((flight) => flight.done));
  }

  /**
   * Row 011-106: whether the daemon's own runtime went, before a tier and
   * when one ends. Once gone it stays gone; a stat that fails otherwise
   * proves nothing.
   */
  async #runtimeMissing(): Promise<boolean> {
    const dir = this.options.runtimeDir;
    if (this.#runtimeGone || dir === undefined) return this.#runtimeGone;
    try {
      await stat(dir);
      return false;
    } catch (error) {
      this.#runtimeGone = isMissing(error);
      return this.#runtimeGone;
    }
  }

  /**
   * Queues the checkpoint at once, unless it needs the runner: while a
   * runner failure is outstanding the runner is retried first, and while a
   * revision waits for its runner part the checkpoint follows it. A warm-up
   * (`observeIgnored`) runs every runnable file forced, in a checkpoint of
   * its own: only its own tiers run flagged, and a forced checkpoint counts
   * only its own tiers' results (review wave 13ar, B1). With a `lane`, only
   * that lane's test files (task 004-61).
   */
  async requestFullSuite(request: FullSuiteRequest = {}): Promise<FullSuiteCheckpoint> {
    const warmUp = request.observeIgnored === true;
    const force = request.force === true || warmUp;
    const lane = request.lane;
    const queue = (ledger: Ledger) => {
      const { policy } = this.#started().context;
      const only = lane === undefined ? undefined : { lane, isSlow: slowView(policy).isSlow };
      const record = queueFullSuite(ledger, force, warmUp, only);
      // Row 011-82: the caller asked for the backlog; it starts at the next tier boundary.
      this.#quiet.end(this.#started().context.now());
      if (warmUp) this.#warmUp.start(this.#started().context, ledger, record);
      return record;
    };
    // An install the next reconciliation pass would find ends the wait first; still waiting,
    // nothing can be listed or keyed and the checkpoint is abandoned at once (review wave 11, B1).
    // A request's pass: its writes keep the store's wait (task 001-422).
    if (this.#awaitingInstall) {
      await this.#handleBatch({ trigger: "interval", paths: [] }, false);
    }
    this.#slow.preempt();
    const record =
      (await this.#lock.run(() => {
        const { ledger } = this.#started();
        if (this.#awaitingInstall || this.#reinstalled) return abandonFullSuite(ledger);
        if (ledger.broken || this.#runnerWork.size > 0 || this.#runnerWork.refining) return null;
        return queue(ledger);
      })) ??
      (await this.#runnerWork.afterTier(async () => {
        const { context, ledger } = this.#started();
        if (this.#awaitingInstall || this.#reinstalled) return abandonFullSuite(ledger);
        await retryRunner(context, ledger);
        return queue(ledger);
      }));
    this.#pump();
    return record;
  }

  /** Spec 004 D2 trigger (b); the slow tier still waits for pending fast work. */
  async requestSlowSuite(): Promise<SlowSuiteRequest> {
    const request = await this.#lock.run(() => {
      const { context, ledger } = this.#started();
      const revision = ledger.revision.number;
      if (this.#awaitingInstall || this.#reinstalled) return { revision, queued: 0 };
      this.#slow.request();
      return { revision, queued: queueSlowSuite(context, ledger) };
    });
    this.#pump();
    return request;
  }

  /** `squeal retry` (001-368): queues the requests in the store that may run now. */
  async requestRetries(): Promise<void> {
    if (this.#closed || this.#reinstalled || this.#awaitingInstall || !this.#context) return;
    await this.#lock.run(() => {
      const { context, ledger } = this.#started();
      if (takeRetries(context, ledger)) ledger.commit();
    });
    this.#pump();
  }

  /**
   * Spec 011 C15: a named wait promotes `testFiles` for `withinMs` on this
   * daemon's clock. Only the order of queued files changes; the pump takes
   * a promoted file at the next tier boundary of a free lane, and the tier
   * in flight there may yield to it (C4 step 5 as amended 2026-10-21, row
   * 011-51).
   */
  async promote(testFiles: readonly TestFileRef[], withinMs: number): Promise<void> {
    if (this.#closed || !this.#context) return;
    await this.#lock.run(() => {
      const { context, ledger } = this.#started();
      ledger.queue.promote(testFiles, context.now() + withinMs);
      this.#cutTiers(null);
    });
    this.#pump();
  }

  /**
   * Spec 011 C15, focused checks (row 011-145): a named wait asks for the
   * checks of `testFiles` that hold one of `texts`, first and alone, for
   * `withinMs` on this daemon's clock. A file that is not listed, slow or of
   * a runner that runs whole files only gets no entry. The tier in flight in
   * a file's lane may yield to it as to a promoted file (C4 step 5).
   */
  async focus(
    testFiles: readonly TestFileRef[],
    texts: readonly string[],
    withinMs: number,
  ): Promise<void> {
    if (this.#closed || !this.#context || texts.length === 0) return;
    await this.#lock.run(() => {
      const { context, ledger } = this.#started();
      const until = context.now() + withinMs;
      for (const ref of testFiles) {
        if (mayFocus(context, ledger, ref)) ledger.queue.focused.add(ref, texts, until);
      }
      this.#cutTiers(null);
    });
    this.#pump();
  }

  nudge(): void {
    // Before `start` has set the context nothing is planned; the start pumps when it ends (review wave-13ak, B1).
    if (this.#closed || !this.#context) return;
    this.#slow.nudge();
  }

  refreshObserved(): boolean {
    if (this.#closed || this.#reinstalled || this.#awaitingInstall || !this.#context) return false;
    this.#runnerWork.queueObserved();
    this.#pump();
    return true;
  }

  status(): SchedulerStatus {
    return { revision: this.#ledger?.revision.number ?? 0 };
  }

  idle(): Promise<void> {
    if (this.#isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.#idle.push(resolve));
  }

  /**
   * Use is the work an edit, a request or a wait caused (011 C9 as amended
   * 2026-10-21, row 011-92): an edit's work and a promoted file
   * (`#editPending`), what is owed (`owedWork`), an open `run --slow`
   * request. The backlog is no use, queued or running.
   */
  inUse(): boolean {
    // A hold is no request and no activity for the idle and unused periods (011 C9, row 011-72).
    if (this.#closed || !this.#ledger || this.#onHold()) return false;
    if (this.#slow.requested && this.slowPending()) return true;
    return this.#editPending() || this.owedWork() !== null;
  }

  /**
   * A departure drain runs only its session's work (011 C9 as amended
   * 2026-10-21, row 011-93): the backlog stays queued, the slow lane waits
   * only for the drain's fast work (004 D2), and the slow tier yields the
   * slot to another worktree's fresh mark. `false` ends the pause.
   */
  pauseBacklog(on: boolean): void {
    if (this.#closed || this.#backlogPaused === on) return;
    this.#backlogPaused = on;
    if (this.#ledger) this.#ledger.backlogPaused = on;
    this.#drainBusyAt = null;
    this.#slow.draining = on;
    this.#slow.preempt();
    this.#pump();
  }

  queued(): number {
    if (this.#closed || !this.#ledger) return 0;
    const { queue } = this.#ledger;
    return queue.fastSize + queue.slowSize;
  }

  slowPending(): boolean {
    // A departure while on hold drains nothing (011 C9, row 011-72).
    if (this.#closed || !this.#ledger || this.#onHold()) return false;
    if (this.#lanes().some(isSlowLane)) return true;
    return this.#ledger.orderedSlow().length > 0;
  }

  owedWork(): string | null {
    if (this.#closed || !this.#ledger || this.#onHold()) return null;
    const ledger = this.#ledger;
    const owed: string[] = [];
    const active = ledger.checkpoints.active;
    if (active?.explicit === true) {
      owed.push(`a \`run --all\` checkpoint (${plural(active.remaining, "test file")} left)`);
    }
    const reruns = [...ledger.files.values()].filter((f) => f.rerunPending && f.phase !== null);
    if (reruns.length === 1) owed.push("a new failure's re-run");
    if (reruns.length > 1) owed.push(`${reruns.length} new failures' re-runs`);
    return owed.length === 0 ? null : owed.join(" and ");
  }

  /**
   * A drain's slow lane waits once the drain's fast work is done (the work
   * `#fastFirst` of the slow tier waits for) and no slow file runs; its wait
   * counts from the later of the last check that found either or began the
   * drain, and the last slow run's end (row 011-163).
   */
  slowWaiting(): SlowWaiting | null {
    if (this.#closed || !this.#ledger || !this.#context || !this.#backlogPaused) return null;
    if (this.#onHold()) return null;
    const queued = this.#ledger.orderedSlow();
    const busy = this.#lanes().some(isSlowLane) || this.#editPending() || !this.#fastIdle();
    if (busy || queued.length === 0 || this.#drainBusyAt === null) {
      this.#drainBusyAt = this.#context.now();
      return null;
    }
    const since = Math.max(this.#drainBusyAt, this.#slow.endedAt ?? 0);
    return { since, paths: queued.map((ref) => ref.path) };
  }

  trackedPaths(): Iterable<RelativePath> {
    return this.#context?.keys.cache.paths() ?? [];
  }

  extraFiles(): readonly RelativePath[] {
    return this.#context?.keys.extraFiles() ?? [];
  }

  /** Spec 015 D9 (review 0.1.297 B3): this worktree's own closures and keys; `null` before it starts. */
  keyIndex(): ClosureIndex | null {
    return this.#context?.keys.index ?? null;
  }

  close(options: SchedulerCloseOptions = {}): Promise<void> {
    // Task 001-367: a stop cancels the tiers in flight, under a close already begun too.
    if (options.cancel === true) this.#stop.abort(options.cause);
    this.#closing ??= this.#close();
    return this.#closing;
  }

  async #close(): Promise<void> {
    this.#closed = true;
    this.#hold.close();
    this.#commandHold.close();
    this.#yields.close();
    this.#slow.close();
    this.#busy?.close();
    this.#notify();
    await this.#pumping;
    this.#capacity?.close();
    this.#runnerWork.cancel();
    await this.#lock.run(() => {
      // Task 001-219: an explicit checkpoint left open is the next daemon's to resume.
      this.#ledger?.checkpoints.owe();
      // Spec 004 D8: a daemon that is gone runs no slow file (review wave 2, B1).
      if (this.#context) this.#retireSlow();
      // A daemon that is gone waits for nothing; the next one decides again.
      if (this.#awaitingInstall) stopWaiting(this.options);
    });
    for (const resolve of this.#idle.splice(0)) resolve();
  }

  /** The close began, or the daemon's stop, which precedes it: no tier starts (row 011-66). */
  #stopping(): boolean {
    return this.#closed || this.options.stopping?.() === true;
  }

  /** No tier starts: the daemon stops, or its own runtime went (row 011-106). */
  #halted(): boolean {
    return this.#stopping() || this.#runtimeGone;
  }

  /**
   * Runs tiers until the queue is empty, one at a time per lane (spec 001 D5
   * as amended, task 001-140): a tier holds the files of one lane, and a
   * lane with a tier in flight waits while the others run theirs. Selection
   * and recording hold the lock; the runs and the stability re-stat do not,
   * so batches are reconciled while tiers are in flight. A backlog tier in
   * flight is cancelled by an edit (task 001-124), and any but the backlog's
   * turn may yield (C4 step 5 as amended 2026-10-21, row 011-51); their
   * unfinished files are queued again.
   *
   * The runner work queued meanwhile is applied in arrival order beside the
   * tiers in flight, not after them (`#drain`). A tier is never selected
   * while runner work is pending: its keys would come from a revision the
   * runner has not invalidated yet. A runner that serializes its calls
   * behind its own run (Vitest's adapter) still holds the runner work for
   * as long as its tier runs.
   *
   * A slow tier (spec 004 D2) is selected when no slow tier and no edit's
   * tier is in flight (`#slowMayStart`); the slow tier itself waits for this
   * daemon's fast backlog unless `run --slow` asked (D2 as amended
   * 2026-10-14, task 004-60), and a backlog tier that arrives while it runs
   * starts beside it (task 004-34). It runs in a lane of its own
   * (`laneOf`, task 004-18), so an edit's fast tier starts beside it. A fast
   * tier that ends gives way at once from the slow tier's load guard, so the
   * backlog's next tier is not held behind the wait.
   *
   * An error of a tier stops the pump with a note; the tier's files go back
   * to the queue, the tiers still in flight are recorded, and the next batch
   * or request starts the pump again.
   */
  #pump(): void {
    if (this.#halted() || !this.#ledger) return;
    if (this.#pumping) {
      this.#asked = true;
      this.#notify();
      return;
    }
    this.#stalled = false;
    this.#failed = false;
    this.#asked = false;
    this.#pumping = (async () => {
      try {
        while (!this.#halted() && !this.#stalled) {
          this.#woken = false;
          this.#drain();
          if (this.#draining) {
            await this.#nextEvent();
            continue;
          }
          if (this.#awaitingInstall || this.#reinstalled) break;
          // The check before a tier, never during one: only when a free lane has a file to take.
          if (this.#inFlight.size > 0 && !this.#freeLaneQueued() && !this.#slowMayStart()) {
            await this.#nextEvent();
            continue;
          }
          const install = await this.#install.check();
          if (install.missing === null && this.#install.takeChange(install)) {
            // Task 001-109 (review wave-11b S2, agreed with the coordinator).
            await this.#lock.run(() => {
              const { context, ledger } = this.#started();
              return refreshInstall(context, ledger);
            });
            continue;
          }
          // Row 011-106: a daemon whose own runtime went starts no tier; its files stay queued.
          if (await this.#runtimeMissing()) break;
          // Row 011-72: the check before a tier; a hold that ended first reconciles what it released.
          const hold = await this.#holdCheck();
          if (hold === "held") break;
          if (hold === "released") continue;
          // Row 011-126: the selection's lookups and the tier's start wait a slice on a busy store.
          const next = await this.#runSliced(() => {
            if (this.#halted() || this.#awaitingInstall || this.#reinstalled) return null;
            if (this.#onHold()) return "held" as const;
            const { context, ledger } = this.#started();
            if (install.missing !== null) {
              this.#reinstall(ledger);
              return null;
            }
            if (this.#runnerWork.size > 0) return "runner-work" as const;
            this.#adopt(context, ledger);
            const tier = selectTier(context, ledger, this.#busyLanes(), this.#yields);
            if (tier === null) return null;
            this.#fly(tier, install.stamp, null);
            // A lane of slots fills every free slot in this hold, so its slots end, and record,
            // together rather than one record per selection (task 011-21 slice 2).
            for (let more = tier; more.slot === true; ) {
              const again = selectTier(context, ledger, this.#busyLanes(), this.#yields);
              if (again === null) break;
              this.#fly(again, install.stamp, null);
              more = again;
            }
            return "flown" as const;
          });
          this.#busy?.landed();
          if (next === "held") break;
          if (next !== null) continue;
          if (this.#reinstalled) break;
          if (this.#slowMayStart()) {
            // Spec 004 D2: no edit's fast work pending or running; the slow tier decides the rest.
            const after = await this.#slow.next((run) => this.#fly(run.tier, install.stamp, run));
            if (after !== null) continue;
          }
          if (this.#started().ledger.claims.waiting) {
            await this.#claimWake();
            continue;
          }
          if (await this.#quietWake()) continue;
          if (await this.#capacityWake()) continue;
          if (this.#inFlight.size === 0 && !this.#woken) break;
          await this.#nextEvent();
        }
      } catch (error) {
        this.#stall(error);
      } finally {
        await Promise.all([...this.#inFlight.values()].map((flight) => flight.done));
        await this.#draining;
        this.#pumping = null;
        if (this.#reinstalled) this.#tellReinstall();
        else if (this.#runtimeGone)
          this.#tellReinstall(runtimeGoneNote(this.options.runtimeDir ?? ""));
        const again = !this.#stalled || this.#asked;
        // A resume after a busy store runs once with nothing queued too: its writes end the wait.
        const work = this.#hasWork() || this.#busy?.waiting === true;
        if (!this.#halted() && again && work) this.#pump();
        else if (this.#isIdle()) for (const resolve of this.#idle.splice(0)) resolve();
      }
    })();
  }

  /**
   * Runs `tier` in its lane and records it under the lock; `slow` is the
   * slow run it belongs to, whose slot it releases. Never rejects: an error
   * stops the pump and puts the tier's files back. A backlog slot (spec 011
   * C4 step 5 as amended for slots, task 011-21 slice 2) returns its permit
   * and frees its place in the lane once its run ends, so the lane's next
   * file starts while it records, and its record joins the other slots that
   * ended by then (`SlotRecords`).
   */
  #fly(tier: Tier, installStamp: string, slow: SlowRun | null): void {
    const { context } = this.#started();
    const first = tier.files[0]?.file.ref;
    const cancellable = tier.slot !== true && first !== undefined && cancels(context, first);
    const held = cancellable ? new AbortController() : null;
    const flight: InFlight = { tier, done: Promise.resolve(), ran: false, held };
    this.#inFlight.set(tier.runId, flight);
    // Row 011-74: a hold's cancel reaches a Vitest run as a stop's does; its runner reads it as its cancel.
    const stop =
      held === null ? this.#stop.signal : AbortSignal.any([this.#stop.signal, held.signal]);
    flight.done = (async () => {
      let recorded = false;
      try {
        const ran = await executeTier(context, tier, this.#warmUp.observes(tier), stop, () =>
          this.#fileEnded(tier),
        );
        if (tier.slot === true) {
          tier.lease?.release();
          flight.ran = true;
          this.#notify();
        }
        const record = await this.#records.record(tier, ran, installStamp, slow, held);
        recorded = true;
        this.#busy?.landed();
        for (const note of record.withheld) this.#note(note);
        slow?.slot.release();
        // The watcher may not have reported these yet; reconciling twice is harmless.
        if (record.moved.length > 0) await this.#reconcilePaths(record.moved);
        if (slow !== null) await this.#releaseIfDrained(tier.lane);
      } catch (error) {
        this.#stall(error, `${plural(tier.files.length, "file")} of a tier queued again`);
        if (!recorded) await this.#requeue(tier, slow !== null);
      } finally {
        slow?.slot.release();
        tier.lease?.release();
        this.#inFlight.delete(tier.runId);
        // A fast tier's lane is free: the slow tier's load guard gives way to its next tier.
        if (slow === null) this.#slow.preempt();
        this.#notify();
      }
    })();
  }

  /**
   * `fn` with each write it awaits waiting at most `busySliceMs` on a busy
   * store, when a busy store's give-up resumes the pump (task 001-422, row
   * 011-126); with the store's own wait otherwise.
   */
  #sliced<T>(fn: () => Promise<T>): Promise<T> {
    const ms = this.options.busySliceMs;
    return ms === undefined || this.#busy === null ? fn() : withBusySlice(ms, fn);
  }

  /** `task` under the lock, `#sliced`. */
  #runSliced<T>(task: () => T | Promise<T>): Promise<T> {
    return this.#sliced(() => this.#lock.run(task));
  }

  /**
   * The slow pass of `lane` drained: no file of it is queued, so its runner
   * instance closes (spec 004 D2). While still in flight, so the lane's next
   * tier waits for the close.
   */
  async #releaseIfDrained(lane: string): Promise<void> {
    const { context, ledger } = this.#started();
    const release = context.runner.releaseLane?.bind(context.runner);
    if (release === undefined || this.#closed) return;
    if (ledger.orderedSlow().some((ref) => laneOf(context, ref) === lane)) return;
    await release(lane).catch((error: unknown) =>
      this.#backgroundError(`could not close the runner of lane ${lane}`, error),
    );
  }

  /** A fast file whose lane may take a tier is queued. */
  #freeLaneQueued(): boolean {
    const { context, ledger } = this.#started();
    const busy = this.#busyLanes();
    const free = (ref: TestFileRef) => !busy.has(laneOf(context, ref));
    return ledger.fastQueued(free) || focusedWaiting(context, ledger, free);
  }

  /** The lanes no tier may start in now. */
  #busyLanes(): Set<string> {
    const { context, ledger } = this.#started();
    const running = [...this.#inFlight.values()].filter(({ ran }) => !ran);
    return busyLanes(
      context,
      ledger,
      running.map(({ tier }) => tier),
    );
  }

  /** The lane of each tier in flight. */
  #lanes(): string[] {
    return [...this.#inFlight.values()].map(({ tier }) => tier.lane);
  }

  /** Applies the queued runner work beside the tiers in flight, unless it is already being applied. */
  #drain(): void {
    if (this.#draining || this.#runnerWork.size === 0) return;
    this.#draining = this.#runnerWork
      .drain()
      .catch((error: unknown) => this.#backgroundError("could not apply runner work", error))
      .finally(() => {
        this.#draining = null;
        this.#notify();
      });
  }

  /**
   * Queued files wait on other worktrees' claims (task 001-205): the pump
   * looks again on `#notify`, when the store moves, or after
   * `CLAIM_RECHECK_MS`, never in a tight loop.
   */
  async #claimWake(): Promise<void> {
    const { context } = this.#started();
    const stop = new AbortController();
    try {
      await Promise.race([this.#nextEvent(), claimWake(context.store, stop.signal)]);
    } finally {
      stop.abort();
    }
  }

  /**
   * A lane with a fast file queued waits for quiet (C4 step 5 as amended
   * 2026-10-21, row 011-82): the pump looks again at the wait's end, at most
   * `QUIET_RECHECK_MS` on, or on `#notify`. False when no such lane waits.
   */
  async #quietWake(): Promise<boolean> {
    const { context, ledger } = this.#started();
    const ms = quietSleepMs(context, ledger);
    if (ms === null) return false;
    await this.#eventOrAfter(ms);
    return true;
  }

  /**
   * A tier the pool refused waits as a waiter (011 C10 as amended
   * 2026-10-21, row 011-96): the pump looks again when a tier of this daemon
   * ends, on `#notify`, or after `CAPACITY_RECHECK_MS`. False when the pool
   * refused none since the last look.
   */
  async #capacityWake(): Promise<boolean> {
    if (this.#capacity?.refused() !== true) return false;
    await this.#eventOrAfter(CAPACITY_RECHECK_MS);
    return true;
  }

  /** Settles on `#notify` or after `ms`, whichever comes first. */
  async #eventOrAfter(ms: number): Promise<void> {
    const stop = new AbortController();
    try {
      await Promise.race([this.#nextEvent(), delay(ms, undefined, { signal: stop.signal })]);
    } finally {
      stop.abort();
    }
  }

  /** Settles when `#notify` is called; at once when it was since the pump's last pass began. */
  #nextEvent(): Promise<void> {
    if (this.#woken) return Promise.resolve();
    return new Promise((resolve) => {
      this.#wake = resolve;
    });
  }

  #notify(): void {
    this.#woken = true;
    const wake = this.#wake;
    this.#wake = null;
    wake?.();
  }

  /**
   * A tier's error: the pump stops with a note until the next batch or
   * request. A busy store's, with `busyWaits`, stops it until `#busy`
   * resumes it, with no note: `waiting` is what its episode's note names.
   * Any other error wins: a resume armed before it, or by a lane's busy
   * record after it, starts nothing until a batch or request does.
   */
  #stall(error: unknown, waiting = "the next tier"): void {
    this.#stalled = true;
    // Only a batch or request after the error starts the pump again.
    this.#asked = false;
    if (this.#busy !== null && isBusy(error)) {
      // After another error the next batch or request resumes the pump, not a busy wait.
      if (!this.#failed) this.#busy.gaveUp(waiting);
      this.#notify();
      return;
    }
    // A resume a busy write armed before this error would run tiers no batch asked for.
    this.#failed = true;
    this.#busy?.abandon();
    this.#note(`scheduler stopped running tiers: ${String(error)}`);
    this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
    this.#notify();
  }

  /**
   * Never while waiting or reinstalled, so the pump cannot re-arm into a wait
   * (review wave 11c, B1). Slow files are not work here: the slow tier pumps
   * again itself while they wait for a trigger or the slot (spec 004 D2).
   */
  #hasWork(): boolean {
    if (this.#awaitingInstall || this.#reinstalled) return false;
    // Row 011-72: on hold, the runner part goes on (D5 step 5) and the queue waits.
    if (this.#onHold()) return this.#runnerWork.size > 0;
    return this.#runnerWork.size > 0 || this.#ledger?.fastQueued() === true || this.#focused();
  }

  /** A focused entry waits for its tier (row 011-145): fast work, an edit's for the slow tier. */
  #focused(): boolean {
    const context = this.#context;
    const ledger = this.#ledger;
    return context !== null && ledger !== null && focusedWaiting(context, ledger);
  }

  /**
   * An edit's fast work goes before a slow file (spec 004 D2 as amended):
   * runner work, a refinement in flight included, a recent fast file queued,
   * or an edit's tier in flight, the backlog's turn included.
   */
  #editPending(): boolean {
    const work = this.#runnerWork;
    if (work.size > 0 || work.refining || this.#ledger?.queue.hasFirstGroup()) return true;
    if (this.#focused()) return true;
    return [...this.#inFlight.values()].some(
      ({ tier }) => tier.kind !== "backlog" && !isSlowLane(tier.lane),
    );
  }

  /**
   * No fast work pending or running: an idle slow tier may take several
   * files (D2). During a drain, the paused backlog is not pending (row 011-93).
   */
  #fastIdle(): boolean {
    const work = this.#runnerWork;
    if (work.size > 0 || work.refining || this.#ledger?.fastQueued() === true) return false;
    if (this.#focused()) return false;
    return this.#lanes().every(isSlowLane);
  }

  /**
   * The pump may ask the slow tier: nothing is in flight (it then also ends
   * a drained pass), or slow files are queued and neither a slow tier nor an
   * edit's tier is in flight.
   */
  #slowMayStart(): boolean {
    if (this.#inFlight.size === 0) return true;
    if ((this.#ledger?.queue.slowSize ?? 0) === 0) return false;
    if (this.#lanes().some(isSlowLane)) return false;
    return !this.#editPending();
  }

  #retireSlow(): void {
    try {
      this.#slow.retire();
    } catch (error) {
      this.#note(`could not clear the slow tier's activity: ${String(error)}`);
    }
  }

  /**
   * Puts the files of a tier that never got recorded back into the queue; a
   * slow one's activity goes. Its commit waits a slice on a busy store (row
   * 011-126).
   */
  async #requeue(tier: Tier, slow: boolean): Promise<void> {
    await this.#runSliced(() => {
      const { context, ledger } = this.#started();
      // Row 011-145: a focused tier holds no file of the queue; its entries wait for another run.
      if (tier.kind === "focused") {
        this.#yields.ended(context, tier);
        return requeueFocusedTier(context, ledger, tier);
      }
      endTier(context, ledger, tier);
      this.#yields.ended(context, tier);
      for (const { file, key } of tier.files) {
        // A newer run has the file at another key: it is that run's (review wave-4 B1).
        if (supersededIn(file, key)) {
          ledger.endRunningAt(file, key);
          continue;
        }
        ledger.setRunning(file, null);
        if (ledger.files.get(file.id) === file) {
          ledger.enqueue(file, priorityOf(file, NOTHING_CHANGED));
        }
      }
      try {
        ledger.commit();
        if (slow) this.#slow.ended();
      } catch (error) {
        // On a busy store the ledger still owes the queue: the resumed pump's commit writes it.
        if (this.#busy === null || !isBusy(error)) {
          this.#note(`could not record the re-queued tier: ${String(error)}`);
        }
      }
    });
  }

  async #reconcilePaths(paths: readonly RelativePath[]): Promise<void> {
    const { context } = this.#started();
    const candidates = await statCandidates(paths, context.hasher);
    // No slice: nothing retries this pass, so its writes wait as long as the store does.
    await this.#handleBatch({ trigger: "watch", paths: candidates }, false);
  }

  #isIdle(): boolean {
    if (this.#closed) return true;
    if (this.#busy?.pending === true) return false;
    return this.#pumping === null && (this.#stalled || !this.#hasWork());
  }

  #started(): { context: SchedulerContext; ledger: Ledger } {
    if (!this.#context || !this.#ledger) throw new Error("squeal scheduler: not started");
    return { context: this.#context, ledger: this.#ledger };
  }

  /** An error of work no caller awaits: a note for status, and `onError`. */
  #backgroundError(subject: string, error: unknown): void {
    this.#note(`${subject}: ${String(error)}`);
    this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
  }

  /** Persists a note for `squeal status` (D7, review S6). */
  #note(message: string): void {
    const { store, worktreeId, now } = this.options;
    const revision = this.#ledger?.revision.number ?? null;
    try {
      appendNote(store, worktreeId, { at: (now ?? Date.now)(), revision, text: message });
    } catch (error) {
      this.options.onError?.(
        new Error(`squeal scheduler: could not persist a note (${message}): ${String(error)}`),
      );
    }
  }
}
