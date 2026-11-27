import { stat } from "node:fs/promises";
import { heldUntilAsked } from "../daemon/check-groups.js";
import { isMissing } from "../fs/errors.js";
import { readObjectFormat } from "../hash/git-index.js";
import { createFsHasher } from "../hash/hasher.js";
import { testFileId } from "../keys/reverse-index.js";
import { appendNote } from "../notes.js";
import { hostLoad } from "../retry/load.js";
import { statCandidates } from "../revision/reconcile.js";
import { readGroupActivity, readSlowActivity } from "../slow/state.js";
import { describeFailure } from "../state/fingerprint.js";
import { retryWhileBusy } from "../store/busy.js";
import { isBusy, withBusySlice } from "../store/connection.js";
import { plural } from "../text.js";
import type { CheckRunner } from "../types/check-groups.js";
import type { EpochMs, ProjectName, RelativePath, RevisionNumber } from "../types/common.js";
import { daemonIncarnation, type SyncAnswer } from "../types/daemon.js";
import type { TestFileRef } from "../types/keys.js";
import type { Policy } from "../types/policy.js";
import { BESIDE_LANE_PREFIX, isBesideLane, type ObservedInputs } from "../types/runner.js";
import {
  type ClosureIndex,
  type FullSuiteCheckpoint,
  type FullSuiteRequest,
  isGroupLane,
  type LockHolder,
  type NarrowRunOptions,
  type NarrowRunRequest,
  type RefinementProgress,
  type Rest,
  type Scheduler,
  type SchedulerCloseOptions,
  type SchedulerStatus,
  SLOW_GROUP,
  type SlowSuiteRequest,
  type SlowWaiting,
  type StepSeen,
} from "../types/scheduler.js";
import type { CandidateBatch } from "../types/watcher.js";
import { type Admission, admit, checkTurn, type StartFacts } from "./admission.js";
import { reconcileBatch } from "./batch.js";
import { besideFiles } from "./beside.js";
import { baseline, deferredStart, scan, type UnseenChanges } from "./bootstrap.js";
import { BusyResume } from "./busy-resume.js";
import { CalendarSteps, steppedClock } from "./calendar-steps.js";
import { TierCapacity } from "./capacity.js";
import { fullSuiteRequest } from "./checkpoint-requests.js";
import { CLAIM_POLL_MS, type ClaimWindow, claimPoll, claimWindow } from "./claims.js";
import { type Clock, clockOf } from "./clock.js";
import { CommandHold } from "./command-hold.js";
import { attachCommitLanes } from "./commit-moment.js";
import type { SchedulerContext } from "./context.js";
import { NOTHING_CHANGED } from "./context.js";
import {
  commitRunners,
  fileRunners,
  groupRunners,
  keyingDeferred,
  stopRunners,
} from "./deferred-keying.js";
import { clearUnknown } from "./files.js";
import { focusedWaiting } from "./focused.js";
import { requeueFocusedTier } from "./focused-record.js";
import { GroupTiers } from "./group-tiers.js";
import { updateCommitReport } from "./head-move.js";
import { MergeHold } from "./hold.js";
import { IgnoredMarks } from "./ignored-marks.js";
import { ImportRewalk } from "./import-rewalk.js";
import { clearImportsWaiting, importRequest, observedRequest } from "./imports-waiting.js";
import {
  AWAITING_INSTALL_REASON,
  missingInstall,
  REINSTALL_NOTE,
  reconcileWaiting,
  startWaiting,
  stopWaiting,
  touchesInstall,
} from "./install.js";
import { InstallStamps } from "./install-stamp.js";
import { WorktreeKeys } from "./keying.js";
import { Ledger } from "./ledger.js";
import { Mutex } from "./mutex.js";
import { publishNarrowAsks } from "./narrow-asks-row.js";
import { narrowRequest, REINSTALLED_REASON } from "./narrow-run.js";
import { provenObserved } from "./observed.js";
import type { SchedulerOptions } from "./options.js";
import { PoolWaits, poolWaitsPublish } from "./pool-wait.js";
import { priorityOf } from "./queue.js";
import { BacklogQuiet, publishQuiet } from "./quiet.js";
import { TierRecords } from "./record.js";
import { RequestIntake } from "./request-intake.js";
import { focusRequest, groupRequest, promoteRequest } from "./request-intake-requests.js";
import { RequestProgress } from "./request-progress.js";
import { RERUN_CAP } from "./rerun.js";
import { retryRequest, takeRetries } from "./retries.js";
import { ALL_RUNNERS, type RunnerGate } from "./runner-gate.js";
import { RunnerWork } from "./runner-work.js";
import { busyLanes } from "./slots.js";
import { groupView } from "./slow.js";
import { SlowRelease } from "./slow-release.js";
import { type LaneEnd, type LaneLoop, type SlowRun, SlowTier } from "./slow-tier.js";
import type { NextWake, ProbeRead, Reads, Step } from "./step.js";
import type { SchedulerEvent } from "./step-events.js";
import { STEP_OPERATION, StepLive, unplaced } from "./step-live.js";
import { supersededIn } from "./store-decision.js";
import { StoredKeys } from "./stored-keys.js";
import { cancels, endTier, executeTier, laneOf, type Tier } from "./tiers.js";
import { type WakeSlot, Wakes } from "./wakes.js";
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
  /**
   * Row 011-351: the one clock, `SchedulerOptions.clock` or the host
   * adapter over `now`. Row 011-377: each calendar reading tells `#steps`.
   */
  readonly #clock: Clock;
  /** Row 011-377: the calendar steps `#clock` saw; each is told to `#shift`. */
  readonly #steps = new CalendarSteps(() => this.#daemonStartedAt());
  /** The start this scheduler's daemon stored on the worktree, once found (`#daemonStartedAt`). */
  #startedAt: EpochMs | null = null;
  readonly #now = (): EpochMs => this.#clock.now();
  /** Row 011-352: the one timer, at the earliest wake an owner states; the rest signal's counts. */
  readonly #wakes: Wakes;
  /** The pump's one wait for an event or a time: its wake. */
  readonly #pumpWake: WakeSlot;
  /** Queued files wait on claims (task 001-205): the store's marker is polled at this wake. */
  readonly #claimsWake: WakeSlot;
  #claimWindow: ClaimWindow | null = null;
  readonly #lock = new Mutex(this.#now, (count) => this.#wakes.locked(count));
  /** Row 015-117: the once-after-upgrade re-walk, made at its first chunk. */
  #rewalk: ImportRewalk | null = null;
  readonly #runnerWork = new RunnerWork({
    lock: this.#lock,
    started: () => this.#started(),
    closed: () => this.#closed,
    pump: () => this.#pump(),
    backgroundError: (subject, error) => this.#backgroundError(subject, error),
    applied: () => this.#stepOutside([{ kind: "runner-work-applied" }]),
    deferred: () => this.#keyingDeferred(),
    // Spec 021 D2: a refinement's writes wait a slice and are tried again, as the pump's are.
    busy: () => {
      const waits = this.options.busyWaits;
      return waits === undefined ? undefined : { sliceMs: this.options.busySliceMs, waits };
    },
  });
  /** Spec 019 D3: a lane per group other than `tests`; the default `slow` group's is the slow tier. */
  readonly #groups: GroupTiers;
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
   * The lanes whose second instance a tier beside ran in and that has not
   * closed: any tier of such a lane that ends decides its close, the one
   * beside a tier that overruns included (row 011-399).
   */
  readonly #besideOpen = new Set<string>();
  /**
   * Which tiers in flight a revision, a runner part or a promotion cancels (C4 step 5, row 011-51);
   * a tier past its estimate is checked again at its bound (row 011-107).
   */
  readonly #yields: TierYields;
  /**
   * The lanes that wait for quiet after a backlog tier's cancel, or before an
   * edit's catch-up (C4 step 5, rows 011-82 and 011-153).
   */
  readonly #quiet = new BacklogQuiet((ends, at, catchUp) =>
    publishQuiet(this.options.store, this.options.worktreeId, ends, this.#steps.stamp(at), catchUp),
  );
  /** The events of the step queued under the lock, not run yet (rows 011-54, 011-107, 011-356). */
  readonly #queued: SchedulerEvent[] = [];
  /** A `run --all` with `observeIgnored` (task 001-307). */
  readonly #warmUp = new WarmUp();
  /** Row 018-12: the files explicit requests queued, whose ends are activity. */
  readonly #requests = new RequestProgress();
  /** Row 011-322: the one place a request is taken; each request method is one call into it. */
  readonly #intake = new RequestIntake({
    lock: this.#lock,
    started: () => this.#started(),
    open: () => !this.#closed && this.#context !== null,
    stopping: () => this.#stopping(),
    waiting: () =>
      this.#awaitingInstall
        ? AWAITING_INSTALL_REASON
        : this.#reinstalled
          ? REINSTALLED_REASON
          : null,
    awaitingInstall: () => this.#awaitingInstall,
    // Spec 021 D2: the request's pass is tried again on a busy store, as the feed's are.
    installPass: () => this.#handleBatch({ trigger: "interval", paths: [] }, true),
    passes: () => this.options.passes,
    busy: () => {
      const waits = this.options.busyWaits;
      return waits === undefined ? undefined : { waits, sliceMs: this.options.busySliceMs };
    },
    runnerPending: () => this.#runnerWork.size > 0 || this.#runnerWork.refining,
    afterRunnerWork: (task, operation) => this.#runnerWork.afterTier(task, operation),
    record: (files) => this.#requests.ask(files),
    wakeAll: () => this.#groups.preempt(),
    wakeLane: (group) => {
      this.#groups.lanes(this.#started().context.policy);
      this.#groups.get(group)?.preempt();
    },
    checkYields: () => this.#stepOutside([{ kind: "request-taken" }]),
    pump: () => this.#pump(),
  });
  /** The records of the runs that ended (row 011-131). */
  readonly #records: TierRecords;
  /**
   * The events posted since the pump's step last read them (row 011-352): a
   * tier ended, runner work drained, a batch or request came, a wake. The
   * step reads and clears them (row 011-356).
   */
  readonly #events: SchedulerEvent[] = [];
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
  /** Spec 026 D1: the start keyed nothing (`deferredStart`); the first explicit request runs the baseline. */
  #baselineOwed = false;
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
  /** Row 011-211: when a slow lane's runner instance closes with its slow files still queued. */
  readonly #slowRelease: SlowRelease;
  /** Spec 021 D2: each retried pass or request waits under a key of its own. */
  #retries = 0;
  /** Paths a merge hold released, read by the step's probe and reconciled by its `reconcile` (row 011-356). */
  readonly #released: RelativePath[] = [];
  /** Row 011-365: the step's ports and its carry-out. */
  readonly #live: StepLive;

  constructor(private readonly options: SchedulerOptions) {
    this.#clock = steppedClock(clockOf(options), this.#steps);
    this.#wakes = new Wakes(this.#clock);
    this.#pumpWake = this.#wakes.slot("pump", () => this.#post({ kind: "wake", reason: "pump" }));
    this.#claimsWake = this.#wakes.slot("claims", (at) => this.#claimPoll(at));
    this.#yields = new TierYields(
      () => this.#stepQueued({ kind: "wake", reason: "yield-bound" }),
      this.#wakes,
    );
    this.#install = new InstallStamps(options.root);
    this.#storedKeys = new StoredKeys(this.#now());
    this.#hold = new MergeHold({
      root: options.root,
      store: options.store,
      worktreeId: options.worktreeId,
      now: this.#now,
      revision: () => this.#ledger?.revision.number ?? 0,
      resumed: () => this.#pump(),
      note: (message) => this.#note(message),
      wakes: this.#wakes,
    });
    this.#commandHold = new CommandHold({
      store: options.store,
      worktreeId: options.worktreeId,
      now: this.#now,
      note: (message) => this.#note(message),
      merging: () => this.#hold.holding,
      wakes: this.#wakes,
      due: () =>
        void this.#wakes.track(() =>
          this.commandHold().catch((error: unknown) =>
            this.#backgroundError("could not end a command hold", error),
          ),
        ),
    });
    this.#busy =
      options.busyWaits === undefined
        ? null
        : new BusyResume(options.busyWaits, () => {
            // Only a pump a busy store stopped: one a batch restarted, or another error stopped, is not this wait's.
            if (this.#stalled && !this.#failed) this.#pump();
          });
    // Row 011-309: a lane the pool refuses waits for CPU, in the daemon's log and for status.
    const waits = new PoolWaits({
      now: this.#now,
      elapsed: this.#clock.elapsed,
      steps: this.#steps,
      log: options.log ?? (() => {}),
      publish: poolWaitsPublish(options.store, options.worktreeId, this.#steps),
    });
    this.#capacity =
      options.capacity === undefined
        ? null
        : new TierCapacity(
            options.capacity,
            options.worktreeId,
            (message) => this.#note(message),
            waits,
          );
    // Row 011-357: a lane reads the scheduler only through what the step passes it.
    const loop: LaneLoop = {
      wakes: this.#wakes,
      now: this.#now,
      pump: () => this.#pump(),
      store: options.store,
      worktreeId: options.worktreeId,
      // Review 0.1.610 B1: status reads which held files a narrow run asked for; row 011-426
      // (review 0.1.650 B1): and the commit asks and open whole-group requests.
      requestsChanged: () => {
        const at = this.#now();
        publishNarrowAsks(
          options.store,
          options.worktreeId,
          this.#groups.narrowAsks(),
          this.#steps.stamp(at),
          { commit: this.#groups.commitAsks(), requested: this.#groups.requestedGroups() },
        );
      },
    };
    this.#groups = new GroupTiers((group) => new SlowTier(loop, options.slow, group));
    this.#slowRelease = new SlowRelease(
      {
        release: (lane) => this.#releaseLane(lane),
        // A lane whose files wait for its load guard keeps its instance too (row 011-211).
        lanes: () => [...this.#lanes(), ...this.#groups.deferring()],
        now: this.#now,
        closed: () => this.#closed,
        wakes: this.#wakes,
      },
      options.slow?.releaseMs,
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
      // A record names no lane: the lane whose tier it recorded publishes (row 019-10).
      slowEnded: () => this.#groups.endedOnce(this.#laneEnd()),
      wakes: this.#wakes,
    });
    this.#live = new StepLive({
      lock: this.#lock,
      install: this.#install,
      yields: this.#yields,
      groups: this.#groups,
      slowRelease: this.#slowRelease,
      runnerWork: this.#runnerWork,
      inFlight: this.#inFlight,
      runtimeDir: options.runtimeDir,
      now: this.#now,
      stepsTotal: () => this.#steps.total,
      started: () => this.#started(),
      admit: (at) => this.#admit(at),
      stalled: () => this.#stalled,
      asked: () => this.#asked,
      busyWaiting: () => this.#busy?.waiting === true,
      draining: () => this.#draining !== null,
      refused: () => this.#capacity?.refused() === true,
      adopt: (context, ledger, at) => this.#adopt(context, ledger, at),
      busyLanes: (at) => this.#busyLanes(at),
      running: () => this.#running(),
      releaseLane: (lane) => this.#releaseLane(lane),
      fly: (tier, stamp, slow, admitted) => this.#fly(tier, stamp, slow, admitted),
      reinstall: (ledger) => this.#reinstall(ledger),
      tellReinstall: (note) => this.#tellReinstall(note),
      drain: () => this.#drain(),
      probe: () => this.#probeRead(),
      reconcileReleased: () => this.#reconcileReleased(),
      queueRewalk: () => this.#queueRewalk(),
    });
    // Row 011-377: told once every owner above exists.
    this.#steps.onStep((ms, at) => this.#shift(ms, at));
  }

  async start(): Promise<void> {
    await this.#lock.run(async () => {
      if (this.#context) throw new Error("squeal scheduler: started twice");
      const { options } = this;
      // Its keys read every import the store holds; an earlier daemon's wait is over.
      clearImportsWaiting(options.store, options.worktreeId);
      const objectFormat = await readObjectFormat(options.root);
      const hasher = options.hasher ?? createFsHasher(options.root, objectFormat);
      const marks = new IgnoredMarks(
        options.root,
        () => keys.extraFiles(),
        (message) => this.#note(message),
      );
      const keys: WorktreeKeys = new WorktreeKeys({
        root: options.root,
        worktreeId: options.worktreeId,
        store: options.store,
        hasher,
        objectFormat,
        policy: options.policy,
        squealVersion: options.squealVersion,
        onExtraFiles: (paths) => options.onExtraFiles?.(paths),
        note: (message) => this.#note(message),
        ignored: (paths) => marks.among(paths),
        now: this.#now,
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
        now: this.#now,
        note: (message) => this.#note(message),
        rerunCap: options.rerunCap ?? RERUN_CAP,
        hostLoad: options.hostLoad ?? hostLoad,
        ...(options.runnerPartMs === undefined ? {} : { runnerPartMs: options.runnerPartMs }),
        ...(options.incarnation === undefined ? {} : { incarnation: options.incarnation }),
        ...(options.predecessor === undefined ? {} : { predecessor: options.predecessor }),
        ...(this.#capacity === null ? {} : { capacity: this.#capacity }),
        quiet: this.#quiet,
        wakes: this.#wakes,
        steps: this.#steps,
      };
      const ledger = new Ledger(context);
      // Spec 019 D5 step 1 (row 019-22): a commit asks the `commit` groups' lanes for its files.
      attachCommitLanes(context, {
        ask: (group, asks) => {
          this.#groups.lanes(context.policy);
          this.#groups.get(group)?.asks.add(asks, ledger);
          // Spec 026 D1.4: a `commit` group's ask opens a deferred runner once the turn ends.
          const runners = groupRunners(context.policy, group);
          if (this.#owesFor(runners)) this.#wakeLater(runners);
        },
        asked: (ref) => {
          const lane = this.#groups.get(groupView(context.policy).of(ref).name);
          // Row 019-49: a narrow run's ask runs the file as a commit's does.
          return lane?.asks.has(ledger, ref) === true || lane?.narrow.has(ledger, ref) === true;
        },
      });
      ledger.backlogPaused = this.#backlogPaused;
      // Row 011-72: a key that names an unmerged path takes no stored result.
      ledger.holds = (ref) => this.#hold.holding && this.#hold.names(keys.stabilityPaths(ref));
      // Row 018-12: an asked file's end is heard where it happens (review wave 3.6, B2).
      // Review 0.1.610 B1: each commit drops the narrow asks a re-key or an end left behind,
      // so the published asks never hold one the lane would not run.
      ledger.ends = {
        ended: (file) => this.#requests.ended(file),
        committed: (files) => {
          this.#requests.committed(files);
          this.#groups.pruneNarrow(ledger);
        },
      };
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
      else await this.#start(context, ledger);
      // A retry an earlier daemon or another worktree's session asked for (001-368).
      if (missing === null && this.#takeRetries(context, ledger)) ledger.commit();
      this.#context = context;
    }, "starting the scheduler");
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
    await this.#lock.run(
      async () => {
        if (this.#reinstalled) return;
        const { context, ledger } = this.#started();
        // A reconciliation or sync pass reads the index when it moved: `git add` makes no batch (row 011-72).
        if (batch.trigger !== "watch") await this.#hold.check();
        if (this.#awaitingInstall) {
          this.#awaitingInstall = await reconcileWaiting(context, ledger, batch, this.#waitChanges);
          if (!this.#awaitingInstall) await this.#start(context, ledger);
          return;
        }
        const pass = () => this.#pass(context, ledger, batch);
        await (sliced ? this.#sliced(pass) : pass());
      },
      batch.paths.length === 0
        ? "reconciling the worktree"
        : `reconciling ${plural(batch.paths.length, "changed path")}`,
    );
    if (this.#reinstalled) this.#tellReinstall();
    else this.#pump();
  }

  /** `handleBatch` once the scheduler takes edits: the revision, then its runner work. */
  async #pass(context: SchedulerContext, ledger: Ledger, batch: CandidateBatch): Promise<void> {
    // Another worktree's heal may have left a file held here (review wave 13i, B1).
    if (ledger.confirmHeld()) ledger.commit();
    // Each pass looks again for a load retry's load, and another worktree's requests (001-368).
    if (batch.trigger === "interval" && this.#takeRetries(context, ledger)) ledger.commit();
    this.#adopt(context, ledger);
    // Spec 026 D1.4: a commit asks a `commit` group for keyed files, so a start that keyed none keys them first.
    const committing = commitRunners(context.policy);
    if (this.#baselineOwed && committing.length > 0) {
      const { head } = await context.head();
      if (head !== ledger.revision.head) {
        const hold = this.#gate?.hold(committing);
        try {
          await this.#catchUp(context, ledger);
        } finally {
          hold?.release();
        }
      }
    }
    const { applied, touched } = await reconcileBatch(context, ledger, batch);
    // Every reconciliation pass looks too: a workspace's `node_modules` is not watched (D5).
    const install = applied?.revision.changes.some((change) => touchesInstall(change.path));
    if (install || batch.trigger === "interval") {
      const { missing } = await this.#install.check();
      // The revision stays unrefined, so the next daemon's `scan` reads its paths as edits.
      // Row 011-366: the step decides the reinstall.
      if (missing !== null) {
        this.#stepOutside([INSTALL_MISSING]);
        return;
      }
    }
    // Task 001-159: the runner hears of a touched-unchanged file before the next tier.
    if (applied === null) {
      if (touched.length > 0) this.#runnerWork.queueTouched(touched);
      // Task 007-26: a quiet pass rechecks what no watched file shows (a pytest installed set).
      else if (batch.trigger === "interval") this.#runnerWork.queueRecheck();
      return;
    }
    this.#groups.preempt();
    // The runner part waits for the runner: a tier in flight may yield first (C4 step 5, row 011-51).
    this.#stepOutside([{ kind: "revision", revision: applied.revision }]);
    this.#runnerWork.queueRefine(applied.revision, applied.content, touched);
    // Spec 026 D1: a reload that makes a group eager wakes the runner for what was owed.
    if (this.#owesKeying() && !this.#keyingDeferred()) this.#wakeLater([]);
  }

  /**
   * Spec 011 C4 step 3 as amended (task 011-23): files with no result at
   * their key take what other worktrees stored there since the last read.
   * Not while runner work waits: keys would come from a revision the runner
   * has not invalidated yet, as a tier's would.
   */
  #adopt(context: SchedulerContext, ledger: Ledger, at?: EpochMs): void {
    if (this.#runnerWork.size > 0 || this.#runnerWork.refining) return;
    this.#storedKeys.adopt(context, ledger, at);
  }

  /**
   * Row 011-356: the step outside the pump's iteration, after `events`,
   * with no reads; its turn's decisions were carried out, an error is
   * thrown. Inside a lock turn it decides the yield check there (C4 step 5
   * as amended 2026-10-21, row 011-51): a revision's pass, applied runner
   * work, a request taken, and the queued check. Row 011-366: also a pass's
   * missing install, a hold's start and a flight's end; the decisions
   * after its turn are its caller's to carry out (`StepLive.after`).
   */
  #stepOutside(events: readonly SchedulerEvent[]): Step {
    const decided = this.#live.step(events, null);
    if (decided.error !== null) throw decided.error;
    return decided;
  }

  /**
   * A file of `tier` ended during its run (row 011-54): the count status
   * reads, then the queued step, whose yield check places the file end.
   */
  #fileEnded(tier: Tier): void {
    // Row 011-209 (F4; agreed by the coordinator, request dd6ee382): the count status reads.
    this.#yields.fileEnded(this.#started().context, tier);
    this.#stepQueued({ kind: "file-ended", runId: tier.runId });
  }

  /**
   * Row 011-356: the step in a lock turn of its own, one queued at a time,
   * after the events posted since it was queued: a file's end (row 011-54)
   * and the bound of a tier past its estimate or of one whose promoted
   * files wait on claims (`TierYields`, rows 011-107, 011-123). Its yield
   * check takes the results other worktrees stored first, so a claimant's
   * record cuts nothing.
   */
  #stepQueued(event: SchedulerEvent): void {
    this.#queued.push(event);
    if (this.#queued.length > 1) return;
    const check = () =>
      this.#lock
        .run(() => {
          const events = this.#queued.splice(0);
          if (!this.#closed) this.#stepOutside(events);
        }, "checking the tiers in flight")
        .catch((error: unknown) =>
          this.#backgroundError("could not check the tiers in flight", error),
        );
    void this.#wakes.track(check);
  }

  /**
   * Spec 026 D1.2: the start's keying, at start or at the install that
   * ends a wait: the baseline, or, while the runner keying is deferred, a
   * start with no runner call that owes the baseline to the first explicit
   * request (`#wakeKeying`).
   */
  async #start(context: SchedulerContext, ledger: Ledger): Promise<void> {
    if (!this.#keyingDeferred()) return this.#baseline(context, ledger);
    stopWaiting(context);
    deferredStart(context, ledger);
    this.#baselineOwed = true;
  }

  /** Spec 026 D1: whether runner keying waits for no request; read from the policy each time. */
  #keyingDeferred(): boolean {
    return keyingDeferred(this.#context?.policy ?? this.options.policy);
  }

  /** Spec 026 D1.2: the start's baseline or runner work is owed to the next wake. */
  #owesKeying(): boolean {
    return this.#baselineOwed || this.#runnerWork.owes;
  }

  /**
   * Spec 026 D1.4: an explicit request opens `runners`. A start that keyed
   * nothing runs its baseline now, with the paths changed since as edits;
   * otherwise the runner work owed since the last wake is queued, so the
   * request waits for it. Review 0.1.616 B1: with a `RunnerGate`, only the
   * deferred ones of `runners` open, each held open until its owed work
   * is applied; one that missed a call is listed and keyed afresh
   * (`RunnerWork.queueWake`). The runner host closes again once idle
   * (`runner.hostIdleMinutes`, 021 D20); later background work is owed
   * again.
   */
  async #wakeKeying(runners: readonly CheckRunner[]): Promise<void> {
    if (this.#closed || this.#context === null) return;
    const hold = this.#gate?.hold(runners);
    try {
      const opened = this.#gate?.owing(hold?.runners ?? []) ?? [];
      if (!this.#owesKeying() && opened.length === 0) return;
      await this.#lock.run(async () => {
        if (this.#closed || this.#awaitingInstall || this.#reinstalled) return;
        const { context, ledger } = this.#started();
        const listed = await this.#catchUp(context, ledger);
        if (!listed && opened.length > 0) this.#runnerWork.queueWake();
      }, "opening the runner for a request");
      this.#pump();
      if ((hold?.runners.length ?? 0) === 0) return;
      // The runners stay open until the work queued for them is applied; a close ends the wait.
      await this.#runnerWork
        .afterTier(async () => {}, "waiting for an opened runner's catch-up")
        .catch(() => {});
    } finally {
      hold?.release();
    }
  }

  /**
   * `#wakeKeying`'s work, under the lock: the owed baseline, or the owed
   * runner work queued. True: the baseline ran, which listed every open runner.
   */
  async #catchUp(context: SchedulerContext, ledger: Ledger): Promise<boolean> {
    if (!this.#baselineOwed) {
      this.#runnerWork.catchUp();
      return false;
    }
    this.#baselineOwed = false;
    const changed = this.#runnerWork.forgetOwed();
    if (changed.size > 0) this.#waitChanges.push(changed);
    await this.#baseline(context, ledger);
    return true;
  }

  /** Spec 026 D1.4: whether a request for `runners` owes a wake first. */
  #owesFor(runners: readonly CheckRunner[]): boolean {
    return this.#owesKeying() || (this.#gate?.owing(runners).length ?? 0) > 0;
  }

  /**
   * Spec 026 D1.4: `take` once `runners` are awake. With nothing owed it is
   * taken in this turn, so a request still joins the pass queued before it
   * (row 011-198).
   */
  #afterWake<T>(runners: readonly CheckRunner[], take: () => Promise<T>): Promise<T> {
    return this.#owesFor(runners) ? this.#wakeKeying(runners).then(take) : take();
  }

  /** `#wakeKeying` from inside a lock turn: it runs once the turn ends. */
  #wakeLater(runners: readonly CheckRunner[]): void {
    void this.#wakes.track(() =>
      this.#wakeKeying(runners).catch((error: unknown) =>
        this.#backgroundError("could not open the runner for a request", error),
      ),
    );
  }

  /**
   * Review 0.1.616 B2 (D1.4): the runners a named wait's `paths` open
   * before their readers are read; `null`: none. A deferred runner never
   * listed here may read any path; one that only owes work, or a start
   * that keyed nothing, opens when a path is neither a listed test file
   * nor read by one, such as a test file added since.
   */
  #namedWake(paths: readonly RelativePath[]): readonly CheckRunner[] | null {
    const context = this.#context;
    const ledger = this.#ledger;
    if (context === null || !ledger || paths.length === 0) return null;
    const { reverse } = context.keys.index;
    const listed = new Set([...ledger.files.values()].map((file) => file.ref.path));
    const unresolved = paths.some(
      (path) => !listed.has(path) && reverse.referencing([path]).length === 0,
    );
    if (this.#baselineOwed || (unresolved && this.#runnerWork.owes)) return ALL_RUNNERS;
    const runners = this.#gate?.owing(ALL_RUNNERS, !unresolved) ?? [];
    return runners.length === 0 ? null : runners;
  }

  /** The policy as the scheduler holds it now. */
  #policy(): Policy {
    return this.#context?.policy ?? this.options.policy;
  }

  get #gate(): RunnerGate | undefined {
    return this.options.runnerGate;
  }

  /** The baseline, at start or at the install that ends a wait; the wait ends in the store with it. */
  async #baseline(context: SchedulerContext, ledger: Ledger): Promise<void> {
    stopWaiting(context);
    const unseen = this.#waitChanges;
    this.#waitChanges = [];
    // Spec 021 D2: its last commit waits a slice and is tried again, as the pump's writes are.
    const waits = this.options.busyWaits;
    const retry =
      waits === undefined
        ? undefined
        : { sliceMs: this.options.busySliceMs, waits, stopped: () => this.#closed };
    await baseline(context, ledger, unseen, this.options.resumesRest === true, retry);
    // Review 0.1.616 B1: what an open runner missed before is listed afresh now.
    this.#gate?.keyed(ALL_RUNNERS);
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
   * Row 011-340: the start facts on disk and in Git, read after the step
   * that asked for them and before the step that starts a tier, fast or
   * slow (row 011-357). The runtime folder first (row 011-106), then the
   * merge hold, the index read when it moved (row 011-72). A hold that
   * ended released its paths: an abort restored their bytes, and their
   * revision comes before any tier, so no tier runs at the keys of the
   * conflicted bytes. They wait in `#released` for the step's `reconcile`
   * (row 011-356), so a step that ends before it loses none. What it finds
   * stays in memory for `#facts`.
   */
  async #probeRead(): Promise<ProbeRead> {
    if (await this.#runtimeMissing()) return "gone";
    await this.#hold.check();
    this.#released.push(...this.#hold.takeReleased());
    if (this.#released.length > 0) return "released";
    return this.#hold.holding || this.#commandHold.holding ? "held" : "free";
  }

  /** Reconciles the paths a hold released (row 011-72). */
  async #reconcileReleased(): Promise<void> {
    const released = this.#released.splice(0);
    if (released.length > 0) await this.#reconcilePaths(released);
  }

  /**
   * Row 011-340: the start facts in memory now (GLOSSARY "Start facts"),
   * for `admit`. The costly ones are read when an answer needs them; their
   * queue and beside answers read `at`, a step's reading (row 011-372), or
   * the clock as they always did.
   */
  #facts(at?: EpochMs): StartFacts {
    const context = this.#context;
    const ledger = this.#ledger;
    const work = this.#runnerWork;
    const ready = context !== null && ledger !== null;
    return {
      turn: this.#lock.turn,
      closed: this.#closed,
      stopping: this.#stopping(),
      runtimeGone: this.#runtimeGone,
      started: ready,
      awaitingInstall: this.#awaitingInstall,
      reinstalled: this.#reinstalled,
      held: this.#hold.holding || this.#commandHold.holding,
      installMissing: this.#live.installMissing,
      runnerWork: work.size,
      refining: work.refining,
      inFlight: [...this.#inFlight.values()].map(({ tier }) => ({
        lane: tier.lane,
        edit: tier.kind !== "backlog" && !isGroupLane(tier.lane),
      })),
      groups: context === null ? null : groupView(context.policy).groups,
      editQueued: () => ledger?.queue.hasFirstGroup(undefined, at) === true,
      fastQueued: () => ledger?.fastQueued(undefined, at) === true,
      focused: () => this.#focused(at),
      freeLaneQueued: () => ready && this.#freeLaneQueued(at),
      lanes: () =>
        context === null
          ? []
          : this.#groups
              .lanes(context.policy)
              .map((lane) => ({ kind: "local", group: lane.group })),
      queued: (name) => ledger?.queue.hasGroup(name) ?? false,
      holdsFollowers: (name) => {
        const lane = this.#groups.get(name);
        if (context === null || ledger === null) return false;
        return lane === undefined
          ? ledger.queue.hasGroup(name)
          : lane.holdsFollowers({ context, ledger }, at);
      },
      slowWaiting: () => context !== null && this.#laneWaiting(context),
    };
  }

  /**
   * The default `slow` group's stored activity is "waiting", or a
   * configured group's (row 011-342): each publishes under its own key.
   */
  #laneWaiting(context: SchedulerContext): boolean {
    const { store, worktreeId } = context;
    if (readSlowActivity(store, worktreeId)?.kind === "waiting") return true;
    return this.#groups
      .lanes(context.policy)
      .some(({ group }) => readGroupActivity(store, worktreeId, group)?.kind === "waiting");
  }

  /** `admit` of the start facts now (row 011-340), at `at` when a step gives its reading. */
  #admit(at?: EpochMs): Admission {
    return admit(this.#facts(at));
  }

  async commandHold(): Promise<boolean> {
    if (this.#closed) return false;
    const was = this.#commandHold.holding;
    if (this.#commandHold.check()) {
      // Row 011-366: the step decides the hold's start; the pump's step closes the idle slow lanes.
      const began = this.#stepOutside([HOLD_BEGAN]);
      await this.#live.after(began);
      if (began.wake.kind === "again") this.#pump();
      return true;
    }
    if (was) this.#pump();
    return false;
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

  /** `squeal run --all` (`fullSuiteRequest`): the checkpoint, after a pass delivered after it. */
  requestFullSuite(request: FullSuiteRequest = {}): Promise<FullSuiteCheckpoint> {
    return this.#afterWake(ALL_RUNNERS, () =>
      this.#intake.take(fullSuiteRequest(request, { quiet: this.#quiet, warmUp: this.#warmUp })),
    );
  }

  /** Row 011-356: each scheduler step, as it ends, until the returned function is called. */
  onStep(listener: (seen: StepSeen) => void): () => void {
    return this.#live.onStep(listener);
  }

  /** Row 011-302: what holds the lock, to a `run-group` request that waits for it. */
  watchLock(listener: (holder: LockHolder | null) => void): () => void {
    return this.#lock.watch(listener, (error) =>
      this.#backgroundError("could not tell what holds the scheduler", error),
    );
  }

  /** Row 011-397: the newest revision while a runner part runs with the lock free (`Scheduler.listing`). */
  listing(): RevisionNumber | null {
    return this.#runnerWork.refining ? (this.#ledger?.revision.number ?? null) : null;
  }

  /** Row 026-32: the step of the runner part `listing` names (`Scheduler.refinementProgress`). */
  refinementProgress(): RefinementProgress | null {
    const progress = this.#runnerWork.progress;
    if (progress === null) return null;
    return { ...progress, revision: this.#ledger?.revision.number ?? progress.revision };
  }

  /**
   * Row 026-32: queues again the `unknown` files whose recorded reason
   * `match`es and whose key is still the one they were marked at
   * (`Scheduler.requeueUnknown`). A blocked file waits for its runner to
   * recover (`settleFailures`); a queued or running one needs nothing.
   */
  async requeueUnknown(match: (reason: string) => boolean): Promise<number> {
    if (this.#closed || this.#context === null || this.#ledger === null) return 0;
    const count = await this.#lock.run(async () => {
      if (this.#closed) return 0;
      const { ledger } = this.#started();
      const refs: TestFileRef[] = [];
      // Review 0.1.637 B2: the ledger's own reasons, never the stored 256-file sample.
      for (const file of ledger.files.values()) {
        if (file.key === null || file.unknownKey !== file.key || file.unknownReason === null)
          continue;
        if (file.blocked !== null || file.phase !== null) continue;
        if (!match(file.unknownReason)) continue;
        clearUnknown(file);
        ledger.touch(file);
        refs.push(file.ref);
      }
      if (refs.length === 0) return 0;
      ledger.settle(refs, NOTHING_CHANGED);
      try {
        ledger.commit();
      } catch (error) {
        // On a busy store the ledger still owes the queue: the pump's commit writes it.
        if (this.#busy === null || !isBusy(error)) {
          this.#note(`could not record the re-queued unknown test files: ${String(error)}`);
        }
      }
      return refs.length;
    }, "re-queueing recovered unknown test files");
    if (count > 0) this.#pump();
    return count;
  }

  /** Spec 004 D2 trigger (b); the slow tier still waits for pending fast work. */
  async requestSlowSuite(): Promise<SlowSuiteRequest> {
    const request = await this.requestGroup(SLOW_GROUP);
    if (request === null) throw new Error("squeal scheduler: the default slow group is missing");
    return request;
  }

  /** Spec 019 D6: `squeal run <group>` (`groupRequest`); `null` for a group the policy lacks. */
  requestGroup(group: string, paths?: readonly RelativePath[]): Promise<SlowSuiteRequest | null> {
    return this.#afterWake(groupRunners(this.#policy(), group), () =>
      this.#intake.take(groupRequest(group, this.#groups, this.options.passes, paths)),
    );
  }

  /** Spec 019 D6 "Narrow run" (row 019-49): `narrowRequest`. */
  requestGroupPaths(
    group: string,
    paths: readonly RelativePath[],
    options: NarrowRunOptions = {},
  ): Promise<NarrowRunRequest | null> {
    return this.#afterWake(groupRunners(this.#policy(), group), () =>
      this.#intake.take(narrowRequest(group, paths, this.#groups, options)),
    );
  }

  /** `squeal retry` (001-368): queues the requests in the store that may run now. */
  requestRetries(): Promise<void> {
    return this.#afterWake(ALL_RUNNERS, () => this.#intake.take(retryRequest()));
  }

  /**
   * `takeRetries`, each retry it claims and queues asked (row 018-12): in a
   * reconciliation pass and at start (review wave 3.6, B3); `squeal retry`'s
   * are its covered files (`retryRequest`). One that waits at the closed
   * load gate asks nothing yet.
   */
  #takeRetries(context: SchedulerContext, ledger: Ledger): boolean {
    return takeRetries(context, ledger, (file) => this.#requests.ask([file]));
  }

  /** Spec 011 C15: a named wait promotes `testFiles` for `withinMs` (`promoteRequest`). */
  promote(testFiles: readonly TestFileRef[], withinMs: number, wakeCatchUp?: true): Promise<void> {
    // Spec 026 D1.4: a named wait whose files need the runner opens it.
    const take = () => this.#intake.take(promoteRequest(testFiles, withinMs, wakeCatchUp));
    return testFiles.length > 0
      ? this.#afterWake(fileRunners(this.#policy(), testFiles), take)
      : take();
  }

  /** Spec 011 C15, focused checks (row 011-145): `focusRequest`. */
  focus(
    testFiles: readonly TestFileRef[],
    texts: readonly string[],
    withinMs: number,
  ): Promise<void> {
    const take = () => this.#intake.take(focusRequest(testFiles, texts, withinMs));
    return testFiles.length > 0
      ? this.#afterWake(fileRunners(this.#policy(), testFiles), take)
      : take();
  }

  nudge(): void {
    // Before `start` has set the context nothing is planned; the start pumps when it ends (review wave-13ak, B1).
    if (this.#closed || !this.#context || !this.#ledger) return;
    const ledger = this.#ledger;
    // Spec 026 D1.4: Stop's required group keys its files first.
    const stopping = stopRunners(this.#started().context.policy);
    if (stopping.length > 0 && this.#owesFor(stopping)) {
      void this.#wakes.track(() =>
        this.#wakeKeying(stopping)
          .then(() => this.#groups.nudge(ledger))
          .catch((error: unknown) =>
            this.#backgroundError("could not open the runner for Stop", error),
          ),
      );
      return;
    }
    this.#groups.nudge(ledger);
  }

  lintRecorded(): Promise<void> {
    if (this.#closed || !this.#context) return Promise.resolve();
    return this.#updateCommit();
  }

  /** Task 003-26: the lifecycle's refresh of the observed reads (`observedRequest`); synchronous. */
  refreshObserved(): boolean {
    return this.#intake.take(observedRequest(() => this.#runnerWork.queueObserved()));
  }

  /** Row 018-28: an import's observed reads (`importRequest`), its mark busy-retried (row 011-323). */
  requestImports(projects: readonly ProjectName[], imports: readonly string[]): Promise<boolean> {
    // Spec 026 D1.2: while deferred, the import's re-key waits for no runner regrow.
    const waits = !this.#keyingDeferred();
    return this.#intake.take(
      importRequest(projects, imports, () => this.#runnerWork.queueObserved(), waits),
    );
  }

  status(): SchedulerStatus {
    return { revision: this.#ledger?.revision.number ?? 0 };
  }

  /**
   * Row 011-234 (005 D2 as amended): the test files whose closure in this
   * worktree's key index holds each of `paths`, read from memory under the
   * lock with the revision they hold at. Before the start, the revision only.
   */
  async readers(paths: readonly RelativePath[]): Promise<SyncAnswer> {
    // Review 0.1.616 B2: a path no listing holds opens the deferred runners first.
    const wake = this.#namedWake(paths);
    if (wake !== null) await this.#wakeKeying(wake);
    return this.#lock.run(() => {
      const revision = this.status().revision;
      if (!this.#context) return { revision };
      const { reverse } = this.#context.keys.index;
      return {
        revision,
        readers: Object.fromEntries(paths.map((p) => [p, reverse.referencing([p])])),
      };
    }, "finding the test files that read the paths of a named wait");
  }

  /**
   * Spec 023 D4.5, D7.3 as amended (row 023-40c; spec 011 file,
   * coordinator-approved): the test files `paths` select, read from the
   * key index under the lock with no runner call (023-46: the runner's
   * `affected` would walk every source again). A file is selected when it
   * is at one of `paths`, when its closure holds one (`referencing`: its
   * imports, declared inputs, observed reads and missing-target
   * candidates), when one is an environment file of its project or a
   * declared input of it; an environment input of no project's files (a
   * lockfile) selects every file. Before the start, none.
   */
  async changedSelects(paths: readonly RelativePath[]): Promise<readonly TestFileRef[]> {
    return this.#lock.run(() => {
      const context = this.#context;
      const ledger = this.#ledger;
      if (context === null || ledger === null || paths.length === 0) return [];
      const { keys } = context;
      const changed = new Set(paths);
      const files = [...ledger.files.values()];
      const projects = new Set(files.map((file) => file.ref.project));
      const inProject = new Set([...projects].flatMap((p) => keys.environmentFiles(p)));
      const everyFile = paths.some((p) => keys.isEnvironmentInput(p) && !inProject.has(p));
      const out = new Map<string, TestFileRef>();
      for (const ref of keys.index.reverse.referencing(paths)) out.set(testFileId(ref), ref);
      for (const { id, ref } of files) {
        if (
          everyFile ||
          changed.has(ref.path) ||
          keys.environmentFiles(ref.project).some((p) => changed.has(p)) ||
          keys.declaredFor(ref.path).some((p) => changed.has(p))
        )
          out.set(id, ref);
      }
      return [...out.values()];
    }, "finding the test files a commit's changed paths select");
  }

  /**
   * Spec 023 D4.9 (row 023-40c; spec 011 file, coordinator-approved): per
   * test file whose closure holds a path `picks` picks, that path (the first
   * in sort order), read from the key index under the lock. Before the
   * start, none.
   */
  async closureReads(
    picks: (path: RelativePath) => boolean,
  ): Promise<ReadonlyMap<string, RelativePath>> {
    return this.#lock.run(() => {
      const out = new Map<string, RelativePath>();
      if (this.#context === null) return out;
      const { index } = this.#context.keys;
      // The reverse index holds each file's closure paths (`KeyIndex.setClosure`): its
      // imports and their resolution candidates, its declared inputs and observed reads.
      const picked = new Map<RelativePath, boolean>();
      const pick = (path: RelativePath) => {
        const known = picked.get(path);
        if (known !== undefined) return known;
        const yes = picks(path);
        picked.set(path, yes);
        return yes;
      };
      for (const ref of index.reverse.testFiles()) {
        const path = index.closure(ref)?.paths.find(pick);
        if (path !== undefined) out.set(testFileId(ref), path);
      }
      return out;
    }, "finding the test files that read paths the commit does not hold");
  }

  /**
   * Use is the work an edit, a request or a wait caused (011 C9 as amended
   * 2026-10-21, row 011-92): an edit's work and a promoted file
   * (`Admission.editPending`), what is owed (`owedWork`), an open `run --slow`
   * request. The backlog is no use, queued or running.
   */
  inUse(): boolean {
    // A hold is no request and no activity for the idle and unused periods (011 C9, row 011-72).
    if (!this.#ledger) return false;
    const admitted = this.#admit();
    if (admitted.quiet) return false;
    if (this.#groups.requested && this.slowPending()) return true;
    return admitted.editPending || this.owedWork() !== null;
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
    this.#groups.draining = on;
    this.#groups.preempt();
    this.#pump();
  }

  queued(): number {
    if (this.#closed || !this.#ledger) return 0;
    const { queue } = this.#ledger;
    return queue.fastSize + queue.slowSize;
  }

  requestProgress(): number {
    return this.#requests.count;
  }

  slowPending(): boolean {
    // A departure while on hold drains nothing (011 C9, row 011-72).
    if (!this.#context || !this.#ledger || this.#admit().quiet) return false;
    if (this.#lanes().some(isGroupLane)) return true;
    return this.#drainable().length > 0;
  }

  /**
   * The queued files of groups other than `tests` that run without a new
   * request: every one but a `commit` or `manual` group's that no request
   * opened (`heldUntilAsked`, spec 019 D1, D5, row 019-47). A drain before
   * exit (004-29) waits for these only.
   */
  #drainable(): TestFileRef[] {
    const { context, ledger } = this.#started();
    const lanes = this.#groups.lanes(context.policy);
    const { groups, of } = groupView(context.policy);
    const waiting = new Map(
      groups
        .filter((g) => heldUntilAsked(g.at))
        .flatMap((g) => {
          const lane = lanes.find((l) => l.group === g.name);
          return lane?.requested === true ? [] : [[g.name, lane] as const];
        }),
    );
    const queued = ledger.orderedSlow();
    // Row 019-22: a file a commit asked for runs without a new request too.
    const runs = (ref: TestFileRef) => {
      const name = of(ref).name;
      return !waiting.has(name) || waiting.get(name)?.asks.has(ledger, ref) === true;
    };
    return waiting.size === 0 ? queued : queued.filter(runs);
  }

  owedWork(): string | null {
    if (!this.#ledger || this.#admit().quiet) return null;
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
   * the slow lane's `waits` names, `Admission.lane`) and no slow file runs; its wait
   * counts from the later of the last check that found either or began the
   * drain, and the last slow run's end (row 011-163).
   */
  slowWaiting(): SlowWaiting | null {
    if (!this.#ledger || !this.#context || !this.#backlogPaused) return null;
    // Row 011-377: a reading first, so a calendar step moves `since` before the caller compares it.
    const now = this.#now();
    const admitted = this.#admit();
    if (admitted.quiet) return null;
    const queued = this.#drainable();
    const busy = this.#lanes().some(isGroupLane) || admitted.editPending || !admitted.fastIdle;
    if (busy || queued.length === 0 || this.#drainBusyAt === null) {
      this.#drainBusyAt = now;
      return null;
    }
    const since = Math.max(this.#drainBusyAt, this.#groups.endedAt ?? 0);
    return { since, paths: queued.map((ref) => ref.path) };
  }

  trackedPaths(): Iterable<RelativePath> {
    return this.#context?.keys.cache.paths() ?? [];
  }

  extraFiles(): readonly RelativePath[] {
    return this.#context?.keys.extraFiles() ?? [];
  }

  /**
   * Row 026-38 (#304; review 0.1.662 B1): the paths of a remote run's
   * observation that its reader's key keeps (`provenObserved`), which the
   * run's proof weighs; all of them before the scheduler starts.
   */
  async provenObserved(observed: ObservedInputs): Promise<readonly RelativePath[]> {
    const context = this.#context;
    if (context === null) return observed.paths;
    return provenObserved(context.keys, context.root, observed);
  }

  /**
   * Spec 015 D9 (review 0.1.297 B3): this worktree's own closures and keys;
   * `null` before it starts. Row 015-75: with each project's runner and
   * environment files.
   */
  keyIndex(): ClosureIndex | null {
    const keys = this.#context?.keys;
    if (keys === undefined) return null;
    const { index } = keys;
    return {
      key: (testFile) => index.key(testFile),
      closure: (testFile) => index.closure(testFile),
      environment: (project) => {
        const runner = keys.runnerOf(project);
        return runner === undefined ? undefined : { runner, files: keys.environmentFiles(project) };
      },
    };
  }

  /** Spec 017 D7 (agreed with 011, 2026-10-26): the pool its tiers share with the lint pass; `null` with none. */
  capacity(): TierCapacity | null {
    return this.#capacity;
  }

  /**
   * Row 011-352: once nothing is left to do (`Scheduler.rest`). A busy
   * store's resume (card 9's) keeps its own timer: it is reported, not
   * waited for.
   */
  async rest(): Promise<Rest> {
    const rest = await this.#wakes.rest();
    return { ...rest, busyResume: this.#busy?.pending === true };
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
    this.#groups.close();
    this.#slowRelease.close();
    this.#busy?.close();
    this.#post({ kind: "closing" });
    await this.#pumping;
    // Row 011-352: after the pump, so a slot record's gather still ends; no owner wakes after it.
    this.#wakes.close();
    this.#capacity?.close();
    this.#runnerWork.cancel();
    await this.#lock.run(() => {
      // Task 001-219: an explicit checkpoint left open is the next daemon's to resume.
      this.#ledger?.checkpoints.owe();
      // Spec 004 D8: a daemon that is gone runs no slow file (review wave 2, B1).
      if (this.#context) this.#retireSlow();
      // A daemon that is gone waits for nothing; the next one decides again.
      if (this.#awaitingInstall) stopWaiting(this.options);
    }, "closing the scheduler");
  }

  /** The close began, or the daemon's stop, which precedes it: no tier starts (row 011-66). */
  #stopping(): boolean {
    return this.#closed || this.options.stopping?.() === true;
  }

  /**
   * Row 015-117: queues the next chunk of the re-walk under the lock, so its
   * marker is written as the scheduler's other writes are; false once the
   * pass is over or the scheduler halts. Row 011-340: the admission is read
   * again in the lock block, so a stop begun meanwhile queues no chunk.
   */
  async #queueRewalk(): Promise<boolean> {
    if (this.#admit().halted || this.#context === null) return false;
    // Spec 026 D1.2: the re-walk asks the runner, so it waits while the keying is deferred.
    if (this.#keyingDeferred()) return false;
    this.#rewalk ??= new ImportRewalk(this.options.squealVersion);
    const rewalk = this.#rewalk;
    return this.#lock.run(() => {
      const { context, ledger } = this.#started();
      // A slow file waiting for the shared slot or the load guard goes first (spec 004 D2, D3).
      if (this.#admit().rewalk !== null) return false;
      const chunk = rewalk.next(context, ledger);
      if (chunk === null) return false;
      this.#runnerWork.queueRewalk(chunk, (closures, changed) =>
        rewalk.apply(context, ledger, chunk, closures, changed),
      );
      return true;
    }, "queueing the import re-walk");
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
   * tier is in flight (`Admission.asked`); the slow tier itself waits for this
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
    if (this.#admit().halted || !this.#ledger) return;
    if (this.#pumping) {
      this.#asked = true;
      this.#post({ kind: "asked" });
      return;
    }
    this.#stalled = false;
    this.#failed = false;
    this.#asked = false;
    this.#pumping = this.#wakes.track(async () => {
      let failed: unknown = null;
      try {
        // Row 011-356: the step decides under the lock; the pump carries out and waits.
        let reads: Reads = {};
        for (;;) {
          // Row 011-126: the step's lookups and a tier's start wait a slice on a busy store.
          const decided = await this.#runSliced(() => this.#step(reads), STEP_OPERATION);
          if (decided.selected && decided.error === null) this.#busy?.landed();
          reads = { ...reads, ...(await this.#live.after(decided)) };
          if (decided.error !== null) throw decided.error;
          if (decided.wake.kind === "end") break;
          // The reads stay for the next step only when this one asked for them.
          if (decided.wake.kind !== "reads") reads = {};
          const waiting = this.#waitFor(decided.wake, decided.mark ?? this.#steps.total);
          if (waiting !== null) await waiting;
        }
      } catch (error) {
        this.#stall(error);
      } finally {
        // Each flight and the drain are pieces of their own; the pump waits for them as for pieces.
        await this.#wakes.waitFor(
          { for: "pieces" },
          Promise.all([...this.#inFlight.values()].map((flight) => flight.done)),
        );
        await this.#wakes.waitFor({ for: "pieces" }, this.#draining ?? Promise.resolve());
        this.#pumping = null;
        // Row 011-356: the step of the pump's end, outside the lock as the end was: its note, and again or rest.
        const ended = this.#live.step([PUMP_ENDED], {});
        // An error of the pump's end is thrown past this block, as it was.
        failed = ended.error;
        if (failed === null && ended.wake.kind === "again") this.#pump();
      }
      if (failed !== null) throw failed;
    });
  }

  /**
   * The wait the step's next wake names: an event, a time or the claims
   * window; `null` to step again at once, with no wait in between.
   */
  #waitFor(wake: NextWake, mark: number): Promise<void> | null {
    switch (wake.kind) {
      case "reads":
      case "again":
      case "end":
        return null;
      case "event":
        return this.#nextEvent();
      case "at":
        return this.#eventOrAt(wake.at, mark);
      case "claims":
        return this.#claimWake(wake.at, mark);
      case "turn":
        throw new Error("squeal scheduler: a pump step ended as one inside another turn");
      default:
        return unplaced(wake);
    }
  }

  /** One step of the pump with `reads` (row 011-356), in this lock turn: the events since the last. */
  #step(reads: Reads): Step {
    return this.#live.step(this.#events.splice(0), reads);
  }

  /**
   * Runs `tier` in its lane and records it under the lock; `slow` is the
   * slow run it belongs to, whose slot it releases. Never rejects: an error
   * stops the pump and puts the tier's files back. A backlog slot (spec 011
   * C4 step 5 as amended for slots, task 011-21 slice 2) returns its permit
   * and frees its place in the lane once its run ends, so the lane's next
   * file starts while it records, and its record joins the other slots that
   * ended by then (`SlotRecords`). `admitted` is the admission it starts
   * on, read in this lock turn (row 011-340).
   */
  #fly(
    tier: Tier,
    installStamp: string,
    slow: SlowRun | null,
    admitted: { readonly turn: number },
  ): void {
    checkTurn(admitted, this.#lock.turn, tier.lane);
    const { context } = this.#started();
    const first = tier.files[0]?.file.ref;
    const cancellable = tier.slot !== true && first !== undefined && cancels(context, first);
    const held = cancellable ? new AbortController() : null;
    const flight: InFlight = { tier, done: Promise.resolve(), ran: false, held };
    this.#inFlight.set(tier.runId, flight);
    if (tier.beside === true) this.#besideOpen.add(tier.lane);
    // Row 011-399: the row says when it overruns, checked then with no other event.
    this.#yields.started(context, tier);
    if (slow !== null) this.#slowRelease.opened(tier.lane);
    // Row 011-74: a hold's cancel reaches a Vitest run as a stop's does; its runner reads it as its cancel.
    const stop =
      held === null ? this.#stop.signal : AbortSignal.any([this.#stop.signal, held.signal]);
    flight.done = this.#wakes.track(async () => {
      let recorded = false;
      try {
        // Row 011-352: while the runner's run goes on the flight does not count; what follows does.
        const ran = await this.#wakes.waitFor(
          { for: "run" },
          executeTier(context, tier, this.#warmUp.observes(tier), stop, () =>
            this.#fileEnded(tier),
          ),
        );
        if (tier.slot === true) {
          tier.lease?.release();
          flight.ran = true;
          this.#post({ kind: "slot-ran", runId: tier.runId });
        }
        const record = await this.#records.record(tier, ran, installStamp, slow, held);
        recorded = true;
        await this.#updateCommit();
        this.#busy?.landed();
        for (const note of record.withheld) this.#note(note);
        slow?.slot.release();
        // The watcher may not have reported these yet; reconciling twice is harmless.
        if (record.moved.length > 0) await this.#reconcilePaths(record.moved);
        // Row 011-366: the step decides the lane's close at its run's end, while still in flight.
        if (slow !== null)
          await this.#live.after(this.#stepOutside([{ kind: "slow-ended", lane: tier.lane }]));
      } catch (error) {
        this.#stall(error, `${plural(tier.files.length, "file")} of a tier queued again`);
        if (!recorded) await this.#requeue(tier, slow !== null);
      } finally {
        slow?.slot.release();
        tier.lease?.release();
        this.#inFlight.delete(tier.runId);
        // Row 011-269: the lane's second instance closes once no batch is left there (row 011-366: the step's).
        if (tier.promoted === true || tier.beside === true || this.#besideOpen.has(tier.lane))
          this.#besideEnded(tier.lane);
        // A fast tier's lane is free: the slow tier's load guard gives way to its next tier.
        if (slow === null) this.#groups.preempt();
        // Row 011-211: a slow lane left open counts toward its close from its own run's end.
        else this.#slowRelease.ended(tier.lane);
        this.#post({ kind: "tier-ended", runId: tier.runId });
      }
    });
  }

  /**
   * Row 019-22 (spec 019 D5 step 3): after a tier's record, or a lint
   * record (row 019-35), the newest commit report may have waited for it.
   * A failure loses the update only, as a note; the next pass that does
   * not move `HEAD` tries again.
   */
  async #updateCommit(): Promise<void> {
    try {
      await this.#lock.run(() => {
        const { context, ledger } = this.#started();
        return updateCommitReport(context, ledger);
      }, "updating the commit report");
    } catch (error) {
      if (!isBusy(error)) this.#note(`could not update the commit report: ${String(error)}`);
    }
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

  /** `task` under the lock, `#sliced`; `operation` names it to a lock watcher (row 011-302). */
  #runSliced<T>(task: () => T | Promise<T>, operation: string): Promise<T> {
    return this.#sliced(() => this.#lock.run(task, operation));
  }

  /** The runner's `releaseLane` of `lane`: its instance closes. */
  async #releaseLane(lane: string): Promise<void> {
    const { context } = this.#started();
    const release = context.runner.releaseLane?.bind(context.runner);
    if (isBesideLane(lane)) this.#besideOpen.delete(lane.slice(BESIDE_LANE_PREFIX.length));
    if (release === undefined || this.#closed) return;
    await release(lane).catch((error: unknown) =>
      this.#backgroundError(`could not close the runner of lane ${lane}`, error),
    );
  }

  /**
   * A fast file whose lane may take a tier is queued, or one a tier beside a
   * batch's takes, at `at` when a step gives its reading (row 011-372).
   */
  #freeLaneQueued(at?: EpochMs): boolean {
    const { context, ledger } = this.#started();
    const busy = this.#busyLanes(at);
    const free = (ref: TestFileRef) => !busy.has(laneOf(context, ref));
    if (ledger.fastQueued(free, at) || focusedWaiting(context, ledger, free, at)) return true;
    return besideFiles(context, ledger, this.#running(), at ?? this.#now()) !== null;
  }

  /** The tiers in flight whose runs have not ended. */
  #running(): Tier[] {
    return [...this.#inFlight.values()].filter(({ ran }) => !ran).map(({ tier }) => tier);
  }

  /**
   * A batch's tier or one beside it in `lane` ended: the step decides its
   * second instance's close, carried out beside the flight's end.
   */
  #besideEnded(lane: string): void {
    const ended = this.#stepOutside([{ kind: "beside-ended", lane }]);
    if (ended.decisions.length > 0) void this.#wakes.track(() => this.#live.after(ended));
  }

  /** The lanes no tier may start in now, at `at` when a step gives its reading. */
  #busyLanes(at?: EpochMs): Set<string> {
    const { context, ledger } = this.#started();
    const running = [...this.#inFlight.values()].filter(({ ran }) => !ran);
    return busyLanes(
      context,
      ledger,
      running.map(({ tier }) => tier),
      at,
    );
  }

  /** The lane of each tier in flight. */
  #lanes(): string[] {
    return [...this.#inFlight.values()].map(({ tier }) => tier.lane);
  }

  /** Applies the queued runner work beside the tiers in flight, unless it is already being applied. */
  #drain(): void {
    if (this.#draining || this.#runnerWork.size === 0) return;
    this.#draining = this.#wakes.track(() =>
      this.#runnerWork
        .drain()
        .catch((error: unknown) => this.#backgroundError("could not apply runner work", error))
        .finally(() => {
          this.#draining = null;
          this.#post({ kind: "runner-work-drained" });
        }),
    );
  }

  /**
   * Queued files wait on other worktrees' claims (task 001-205): the pump
   * looks again on an event, when the store moves, or after
   * `CLAIM_RECHECK_MS`, never in a tight loop. The claims owner polls the
   * store's marker at its wake (row 011-352).
   */
  async #claimWake(at: EpochMs, mark: number): Promise<void> {
    const { context } = this.#started();
    // Review 0.1.524 B2: a reading first, then the step's `at` moved by the steps since the step read it.
    this.#now();
    this.#claimWindow = claimWindow(context.store, this.#steps.since(at, mark));
    this.#claimsWake.after(CLAIM_POLL_MS);
    try {
      await this.#nextEvent();
    } finally {
      this.#claimWindow = null;
      this.#claimsWake.clear();
    }
  }

  /**
   * Row 011-377 (`tasks/011-377/notes.md`, "Design"): the calendar stepped
   * `ms` at `at`. Each owner of a wait that compares a calendar time moves
   * the times it keeps by `ms`, so each wait keeps its elapsed time left; an
   * owner that publishes its ends writes them again. Stored stamps stay.
   */
  #shift(ms: number, at: EpochMs): void {
    this.#quiet.shift(ms, at);
    if (this.#claimWindow !== null)
      this.#claimWindow = {
        ...this.#claimWindow,
        until: (this.#claimWindow.until + ms) as EpochMs,
      };
    if (this.#drainBusyAt !== null) this.#drainBusyAt = (this.#drainBusyAt + ms) as EpochMs;
    this.#ledger?.queue.shift(ms);
    this.#ledger?.claims.shift(ms);
    this.#groups.shift(ms);
    this.#slowRelease.shift(ms);
    this.#yields.shift(ms, at, this.#context ?? undefined);
  }

  /**
   * Review 0.1.524 B1: the start this scheduler's daemon stored on the
   * worktree, found by its incarnation, so a predecessor's or a successor's
   * record is never taken for it; `null` while none matches, or with no
   * incarnation (a scheduler outside a daemon).
   */
  #daemonStartedAt(): EpochMs | null {
    if (this.#startedAt !== null || this.options.incarnation === undefined) return this.#startedAt;
    const record = this.options.store.worktrees.get(this.options.worktreeId)?.daemon ?? null;
    if (record !== null && daemonIncarnation(record) === this.options.incarnation)
      this.#startedAt = record.startedAt;
    return this.#startedAt;
  }

  /** The claims owner's wake: an event when the store moved or the window passed; else the next poll. */
  #claimPoll(at: EpochMs): void {
    const window = this.#claimWindow;
    if (window === null) return;
    const next = claimPoll(this.#started().context.store, window, at);
    if (next === "ends") this.#post({ kind: "wake", reason: "claims" });
    // Row 011-369: the next poll is a calendar time from the pass's reading; the wake is the delay.
    else this.#claimsWake.after(next - at);
  }

  /** The pump's one wait (row 011-352): an event, or its wake at `at`, whichever comes first. */
  async #eventOrAt(at: EpochMs, mark: number): Promise<void> {
    // Row 011-369: `at` is a calendar time (a quiet end, a deadline): the wake is the delay to it.
    // Review 0.1.524 B2: the reading first; `at` is moved by the steps since the step read it (`mark`),
    // so a step between the decision and here adds nothing to the delay.
    const now = this.#now();
    this.#pumpWake.after(this.#steps.since(at, mark) - now);
    try {
      await this.#nextEvent();
    } finally {
      this.#pumpWake.clear();
    }
  }

  /**
   * Settles on the next event; at once when one came since the pump's pass
   * began. The pump counts as the scheduler's work only while it has work it
   * can do now: it waits in the named wait for an event, so a rest can come while it waits,
   * and its count is back before it acts on the event (review 0.1.513 B1).
   */
  #nextEvent(): Promise<void> {
    if (this.#events.length > 0) return Promise.resolve();
    return this.#wakes.waitFor(
      { for: "event" },
      new Promise<void>((resolve) => {
        this.#wake = resolve;
      }),
    );
  }

  /** Posts `event` (row 011-352): the pump's wait ends. */
  #post(event: SchedulerEvent): void {
    this.#events.push(event);
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
      this.#post({ kind: "stalled" });
      return;
    }
    // A resume a busy write armed before this error would run tiers no batch asked for.
    this.#failed = true;
    this.#busy?.abandon();
    this.#note(`scheduler stopped running tiers: ${String(error)}`);
    this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
    this.#post({ kind: "stalled" });
  }

  /** A focused entry waits for its tier (row 011-145): fast work, an edit's for the slow tier. */
  #focused(at?: EpochMs): boolean {
    const context = this.#context;
    const ledger = this.#ledger;
    return context !== null && ledger !== null && focusedWaiting(context, ledger, undefined, at);
  }

  /** A slow run's end as its lane publishes it (`SlowTier.ended`): the state and admission now. */
  #laneEnd(): LaneEnd {
    return { ...this.#started(), admit: () => this.#admit() };
  }

  #retireSlow(): void {
    try {
      this.#groups.retire();
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
        if (slow) this.#groups.endedOnce(this.#laneEnd());
      } catch (error) {
        // On a busy store the ledger still owes the queue: the resumed pump's commit writes it.
        if (this.#busy === null || !isBusy(error)) {
          this.#note(`could not record the re-queued tier: ${String(error)}`);
        }
      }
    }, "putting the files of an unrecorded tier back in the queue");
  }

  /**
   * A watch pass over `paths`: a hold's released paths, or what a run moved.
   * No change feed retries it: with `busyWaits` its writes wait a slice and
   * a busy store's refusal is tried again, stat and all, until it lands or
   * the scheduler closes (spec 021 D2); with the store's own wait otherwise.
   */
  async #reconcilePaths(paths: readonly RelativePath[]): Promise<void> {
    const waits = this.options.busyWaits;
    const sliced = this.#busy !== null && waits !== undefined;
    const pass = async () => {
      const { context } = this.#started();
      const candidates = await statCandidates(paths, context.hasher);
      await this.#handleBatch({ trigger: "watch", paths: candidates }, sliced);
    };
    if (!sliced) return pass();
    await retryWhileBusy(pass, {
      waits,
      key: `scheduler:paths:${++this.#retries}`,
      what: `a pass over ${plural(paths.length, "path")}`,
      stopped: () => this.#closed,
    });
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
    const { store, worktreeId } = this.options;
    const revision = this.#ledger?.revision.number ?? null;
    try {
      appendNote(store, worktreeId, { at: this.#now(), revision, text: message });
    } catch (error) {
      this.options.onError?.(
        new Error(`squeal scheduler: could not persist a note (${message}): ${String(error)}`),
      );
    }
  }
}

/** The event of the pump's end step (row 011-356). */
const PUMP_ENDED: SchedulerEvent = { kind: "pump-ended" };

/** The events of a hold's start and of a pass's missing install (row 011-366). */
const HOLD_BEGAN: SchedulerEvent = { kind: "hold-began" };
const INSTALL_MISSING: SchedulerEvent = { kind: "install-missing" };
