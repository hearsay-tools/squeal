import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { PoolCapacity } from "../capacity/index.js";
import type { DaemonLoop } from "../daemon-loop/index.js";
import { linkedWorktreeDir } from "../fs/index.js";
import { readDaemonNotes } from "../notes.js";
import { slowSlotDir } from "../slow/index.js";
import { recordOptimizerOff } from "../state/optimizer-note.js";
import { BUSY_SLICE_MS, BusyWaits, isBusy, setBusyTimeout } from "../store/index.js";
import type {
  AbsolutePath,
  Capacity,
  DaemonExit,
  DaemonExitReason,
  DaemonPhase,
  EpochMs,
  FullSuiteCheckpoint,
  FullSuiteRequest,
  Policy,
  RunnerAdapter,
  StoppedProcesses,
  SyncAnswer,
  TestFileRef,
  WorktreeId,
} from "../types/index.js";
import {
  bootstrappedMetaKey,
  DEFAULT_POLICY,
  daemonExitMetaKey,
  daemonIncarnation,
  predecessorIncarnation,
  SLOW_LANE_PREFIX,
} from "../types/index.js";
import { type FrontDesk, type PreparedDesk, prepareFrontDesk } from "./desk.js";
import { afterEachRun, EscapedChildren } from "./escaped.js";
import { type GcFunction, IdleGc } from "./idle-gc.js";
import { recordDaemonUsed } from "./last-use.js";
import {
  type DaemonTimings,
  type ObservedSeen,
  type Presence,
  startTimers,
  stepDownNote,
} from "./lifecycle.js";
import { writeNote } from "./notes.js";
import {
  abandon,
  DAEMON_BUSY_TIMEOUT_MS,
  exit,
  message,
  type OpenedDaemon,
  openDaemon,
} from "./open.js";
import { prepareSocketDir, socketPathFor } from "./paths.js";
import { describeProblems, lastPolicyNote, loadPolicy, POLICY_FILE } from "./policy.js";
import { requestSlowSuite, type SlowSuiteRequested } from "./run-slow.js";
import type { RecoveringRunner } from "./runner.js";
import { adoptScratch, inRootWhileRunning, removeScratch } from "./scratch.js";
import { pauseAt } from "./test-pause.js";
import { capacityReader, repositoryRootOf } from "./user-config.js";
import { squealVersion } from "./version.js";

export type { DaemonTimings } from "./lifecycle.js";

/**
 * After a stop's cancel, how long the tiers in flight get to end before the
 * processes of runners that cannot cancel are stopped: Vitest's own cancel
 * forces its workers after 1 s (task 001-367).
 */
const CANCEL_GRACE_MS = 2_000;

export interface DaemonOptions {
  /** The worktree root; resolved with realpath. */
  readonly root: string;
  /** For the runtime dir of the socket (D1). Default `process.env` as it was before `ownsProcess`. */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * The process is this daemon's (`squeal daemon`): it leaves the root as its
   * working directory and takes its own temp directory (D10,
   * `adoptScratch`). A daemon started inside a test leaves its process alone.
   */
  readonly ownsProcess?: boolean;
  readonly now?: () => EpochMs;
  /** One line per event, for the foreground process's stderr. */
  readonly log?: (line: string) => void;
  readonly timings?: Partial<DaemonTimings>;
  /**
   * Task 001-130: a successor spawned by a step-down waits up to this long
   * for the lock instead of exiting at once (`squeal daemon --await-lock`).
   */
  readonly awaitLockMs?: number;
  /**
   * The user's `capacity` numbers for this repository (spec 001 D11
   * Capacity): the host's slots and the project's cap. Absent: CPUs − 1 and
   * no project cap. The pool is the slow slot's directory under `env`.
   */
  readonly capacity?: PoolCapacity;
  /** How the daemon finds V8's `gc` for its idle GC (row 011-69). Default `exposeGc`. */
  readonly gc?: () => GcFunction | null;
}

/** A daemon that owns its worktree: lock held, socket bound, worktree registered. */
export interface RunningDaemon {
  readonly root: AbsolutePath;
  readonly worktreeId: WorktreeId;
  readonly socketPath: AbsolutePath;
  /** Settles once the scheduler started (baseline lookup done, watcher on) or the daemon gave up. */
  readonly ready: Promise<void>;
  readonly exited: Promise<DaemonExit>;
  /** Shuts down in the D10 order: loop, runner, temp dir, `setDaemon(null)`, store, socket, lock. */
  stop(reason: Extract<DaemonExitReason, "stop-requested" | "signal">): Promise<DaemonExit>;
}

/**
 * Starts the daemon of one worktree. Spec 001 D10 and the start order of the
 * wave 2 review inputs: worktree, lock and store (`openDaemon`), then the
 * socket, which answers pings from here on; the worktree row and the daemon
 * record; the policy; the runner, the state sink and the daemon loop, loaded
 * only now so the socket is up within the hooks' spawn budget. Returns a
 * `DaemonExit` when this process must not serve: not a worktree, store
 * newer or unusable, lock lost, socket directory refused.
 *
 * Spec 001 D12 as amended: the daemon has no log file, so every exit after
 * the store opened persists a note with its reason first, start failures
 * included.
 */
export async function startDaemon(options: DaemonOptions): Promise<RunningDaemon | DaemonExit> {
  const now = options.now ?? Date.now;
  const desk = prepareFrontDesk();
  const opened = await openDaemon(options.root, now, options.awaitLockMs);
  if ("reason" in opened) {
    desk.discard();
    return opened;
  }
  let daemon: Daemon;
  try {
    // The socket's runtime dir comes from the environment hooks share, read before it changes.
    const env = options.env ?? { ...process.env };
    if (options.ownsProcess) adoptScratch(opened.scratch);
    daemon = new Daemon(opened, { ...options, env });
  } catch (error) {
    desk.discard();
    return abandon(opened, now, options.log, `daemon exited: could not start: ${message(error)}`);
  }
  return daemon.start(desk);
}

/** The topic of the busy store's episode notes (task 001-422). */
const BUSY_TOPIC = "daemon:store-busy";

class Daemon {
  readonly #log: (line: string) => void;
  readonly #now: () => EpochMs;
  readonly #socketPath: AbsolutePath;
  readonly #startedAt: EpochMs;
  /** Drawn at start: with the version and `#startedAt`, its incarnation (task 001-270). */
  readonly #token = randomUUID();
  /** The incarnation registered before this daemon's (`predecessorIncarnation`, task 001-268). */
  #predecessor: string | null | undefined = undefined;
  readonly #version = squealVersion();
  #phase: DaemonPhase = "starting";
  #policy: Policy = DEFAULT_POLICY;
  /**
   * D11 Capacity from the user-level config, read again at each call. The
   * daemon calls it at start and sizes its pool from that reading (001-376).
   */
  readonly #capacity: () => Capacity;
  /** The main worktree's root: `capacity.projects`' key and the pool's project id (review 001-384, B3). */
  readonly #repositoryRoot: AbsolutePath;
  #desk: FrontDesk | null = null;
  #runner: RunnerAdapter | null = null;
  /** The Vitest part of `#runner`, which `run --all` asks to retry its creation. */
  #vitest: RecoveringRunner | null = null;
  #loop: DaemonLoop | null = null;
  /**
   * What its tests leave running, stopped after each tier and at exit (D12).
   * Their mark is the registration's token, which `squeal stop` reads to
   * wait for them (task 001-367).
   */
  readonly #children = new EscapedChildren(this.#token);
  /**
   * A `squeal stop` or a step-down was accepted: no tier starts, and those in
   * flight are cancelled (D10; row 011-31).
   */
  #stopRequested = false;
  /** The cancel of the tiers in flight a stop or a step-down began (`#cancelTiers`). */
  #cancelling: Promise<void> = Promise.resolve();
  #starting: Promise<void> = Promise.resolve();
  #stopTimers: () => void = () => {};
  #lastActive: EpochMs;
  /** Last edit, tier, wait or request; registered consumers are no use (task 001-415). */
  #lastUsed: EpochMs;
  readonly #presence: Presence;
  /** Task 003-42: a timer restart starts from the snapshot its predecessor took. */
  readonly #observedSeen: ObservedSeen = {};
  /** What waits for a busy store, the pass's, the pump's and the timers' writes (task 001-422). */
  readonly #busyWaits: BusyWaits;
  /** Spec 011 C9 (row 011-69): one last-resort GC once no tier ran for 60 s. */
  readonly #idleGc: IdleGc;
  #exit: Promise<DaemonExit> | null = null;
  /** `#register` committed: only then has its shutdown a mark to write (task 001-276). */
  #registered = false;
  #resolveExit: (exit: DaemonExit) => void = () => {};
  readonly #exited = new Promise<DaemonExit>((resolve) => {
    this.#resolveExit = resolve;
  });

  constructor(
    private readonly opened: OpenedDaemon,
    private readonly options: DaemonOptions,
  ) {
    this.#log = options.log ?? (() => {});
    this.#now = options.now ?? Date.now;
    this.#socketPath = socketPathFor(opened.worktreeId, options.env);
    this.#startedAt = this.#now();
    this.#lastActive = this.#startedAt;
    this.#lastUsed = this.#startedAt;
    this.#presence = { since: this.#startedAt, lastPresentAt: null };
    // One note per episode, under one topic: status lists the latest (task 001-422).
    this.#busyWaits = new BusyWaits({
      now: this.#now,
      note: (text) => this.#note(text, undefined, undefined, BUSY_TOPIC),
    });
    this.#idleGc = new IdleGc({
      now: this.#now,
      note: (text) => this.#note(text),
      log: this.#log,
      ...(options.gc === undefined ? {} : { lookup: options.gc }),
    });
    this.#repositoryRoot = repositoryRootOf(opened.root, opened.commonDir);
    this.#capacity = capacityReader({
      repositoryRoot: this.#repositoryRoot,
      env: options.env,
      lastNote: (path) => lastPolicyNote(opened.store, opened.worktreeId, path),
      note: (text) => this.#note(text),
    });
  }

  /** The pool's numbers: the options' when a caller set them, else the user's config (task 001-377). */
  #poolCapacity(): PoolCapacity {
    if (this.options.capacity !== undefined) return this.options.capacity;
    const { hostSlots, projectSlots } = this.#capacity();
    if (projectSlots === undefined) return { hostSlots };
    return { hostSlots, project: { id: this.#repositoryRoot, slots: projectSlots } };
  }

  async start(desk: PreparedDesk): Promise<RunningDaemon | DaemonExit> {
    const { root, worktreeId } = this.opened;
    try {
      prepareSocketDir(this.#socketPath, this.options.env);
    } catch (error) {
      desk.discard();
      return this.#shutdown("start-failed", 1, `could not start serving: ${message(error)}`);
    }
    try {
      this.#desk = await this.#openDesk(desk);
      this.#register();
    } catch (error) {
      return this.#shutdown("start-failed", 1, `could not start serving: ${message(error)}`);
    }
    try {
      const { policy, problems } = loadPolicy(root);
      this.#policy = policy;
      this.#notePolicyProblems(problems);
      // Its problems are noted at start, as the policy's are, not at the first backlog tier.
      this.#capacity();
      this.#startTimers();
    } catch (error) {
      return this.#shutdown("start-failed", 1, `daemon exited: could not start: ${message(error)}`);
    }
    this.#starting = this.#run();
    const ready = this.#starting.catch(() => {});
    return {
      root,
      worktreeId,
      socketPath: this.#socketPath,
      ready,
      exited: this.#exited,
      stop: (reason) => this.#shutdown(reason, 0, `daemon stopped: ${reason}`),
    };
  }

  /** (Re)starts heartbeat, lifecycle checks and pruning with the current policy. */
  #startTimers(): void {
    this.#stopTimers();
    this.#stopTimers = startTimers({
      ...this.opened,
      policy: this.#policy,
      now: this.#now,
      linkedDir: linkedWorktreeDir(this.opened.root),
      timings: this.options.timings ?? {},
      heartbeatMs: this.#heartbeatMs(),
      presence: this.#presence,
      lastActive: () => this.#lastActive,
      active: (at) => {
        this.#lastActive = at;
      },
      lastUsed: () => this.#lastUsed,
      used: (at) => {
        this.#lastUsed = at;
      },
      work: () =>
        this.#loop === null || this.#phase === "stopping"
          ? null
          : {
              revision: this.#loop.scheduler.status().revision,
              busy: this.#loop.scheduler.busy(),
            },
      // Task 003-26: queued runner work, never activity; until the scheduler takes it, asked again.
      observedChanged: () =>
        this.#loop !== null && this.#phase !== "stopping" && this.#loop.scheduler.refreshObserved(),
      observedSeen: this.#observedSeen,
      // Task 004-29: the last session's departure drains these before the exit.
      slowPending: () =>
        this.#loop !== null && this.#phase !== "stopping" && this.#loop.scheduler.slowPending(),
      // Task 001-219: so are an explicit checkpoint and a new failure's re-run.
      owedWork: () =>
        this.#loop !== null && this.#phase !== "stopping" ? this.#loop.scheduler.owedWork() : null,
      idleGc: () => {
        if (this.#phase !== "stopping") this.#idleGc.check();
      },
      note: (text) => this.#note(text),
      log: this.#log,
      busyWaits: this.#busyWaits,
      shutdown: (reason, text) => void this.#shutdown(reason, 0, text),
    });
  }

  /**
   * Spec 001 D11: a bad policy is a state; "the daemon persists one note and
   * keeps running". One note per distinct problem set: a restart that finds
   * the same problems as the last policy note adds none.
   */
  #notePolicyProblems(problems: readonly string[]): void {
    if (problems.length === 0) return;
    const text = `${POLICY_FILE}: ${describeProblems(problems)}`;
    if (lastPolicyNote(this.opened.store, this.opened.worktreeId) === text) {
      this.#log(text);
      return;
    }
    this.#note(text);
  }

  /**
   * `SchedulerOptions.reloadPolicy`: spec 001 D11, "a revision that changes
   * the file reloads it and re-keys what `inputs` and `env.allowlist`
   * touch". The scheduler re-keys; the daemon restarts its timers for
   * `daemon.*` and `store.*` and notes the reload.
   */
  #reloadPolicy(): Policy {
    const { policy, problems } = loadPolicy(this.opened.root);
    this.#policy = policy;
    if (this.#phase !== "stopping") this.#startTimers();
    const found = problems.length > 0 ? `: ${describeProblems(problems)}` : "";
    this.#note(`${POLICY_FILE} changed; policy reloaded${found}`);
    return policy;
  }

  #heartbeatMs(): number {
    return this.options.timings?.heartbeatMs ?? 5_000;
  }

  /**
   * Review wave 2 input 4: `worktrees.upsert`, then `setDaemon` with the
   * socket and a heartbeat. A predecessor's `running` rows become `queued`
   * first: with this heartbeat they would read as live claims until the
   * baseline rewrites them (D10 as amended, task 001-205). A predecessor's
   * shutdown mark goes (task 001-274); if this daemon's own shutdown already
   * began, its mark replaces it in the same transaction, since `#markExit`
   * had no registration to describe then (task 001-276). The heartbeat's last
   * use replaces the predecessor's too (spec 014 D9).
   */
  #register(): void {
    const { store, worktreeId: id, root, commonDir } = this.opened;
    store.transaction(() => {
      const existing = store.worktrees.get(id);
      // Before this registration replaces it: whose rows this daemon's ledger finds (001-268).
      this.#predecessor = predecessorIncarnation(existing !== null, store.worktrees.lastDaemon(id));
      store.testFileKeys.releaseRunning(id);
      if (this.#exit === null) store.meta.delete(daemonExitMetaKey(id));
      else store.meta.set(daemonExitMetaKey(id), this.#incarnation());
      store.worktrees.upsert({
        id,
        root,
        commonDir,
        isMain: linkedWorktreeDir(root) === null,
        registeredAt: existing?.registeredAt ?? this.#startedAt,
        daemon: null,
      });
      store.worktrees.setDaemon(id, {
        socketPath: this.#socketPath,
        startedAt: this.#startedAt,
        heartbeatAt: this.#now(),
        heartbeatIntervalMs: this.#heartbeatMs(),
        squealVersion: this.#version,
        token: this.#token,
      });
      recordDaemonUsed(store, id, { usedAt: this.#lastUsed, activeAt: this.#lastActive });
    });
    this.#registered = true;
  }

  /** Its registration's incarnation (`daemonIncarnation`). */
  #incarnation(): string {
    return daemonIncarnation({
      squealVersion: this.#version,
      startedAt: this.#startedAt,
      token: this.#token,
    });
  }

  /** Runner, sink and loop. The heavy modules load here, after the socket is up. */
  async #run(): Promise<void> {
    const { root, worktreeId, store, commonDir } = this.opened;
    try {
      const [
        { createDaemonLoop },
        { createStateSink, describeFailure },
        vitest,
        nodeTest,
        pytest,
        runnerModule,
        { createCompositeRunner },
        { withSlowInstance },
        { awaitsInstall },
      ] = await Promise.all([
        import("../daemon-loop/index.js"),
        import("../state/index.js"),
        import("../../runners/vitest/index.js"),
        import("./node-test-runners.js"),
        import("./pytest-runners.js"),
        import("./runner.js"),
        import("./composite-runner.js"),
        import("./slow-instance.js"),
        import("../scheduler/index.js"),
      ]);
      const { storePaths } = await import("../store/index.js");
      const around = this.options.ownsProcess
        ? inRootWhileRunning(root, this.opened.scratch)
        : undefined;
      // Spec 003 D7: one runner per configured or detected runner. Vitest is
      // built when detected, or when nothing else is configured, so a project
      // with neither keeps the "project without Vitest" failure note (001 D11).
      const configured = this.#policy.nodeTest;
      const configuredPytest = this.#policy.pytest;
      // Each Vitest instance's workers carry the mark of its lane (001 D12, task 004-18).
      const vitestInstance = (lane: string, maxWorkers?: number) => () =>
        vitest.createVitestAdapter({
          root,
          note: (text) => this.#note(text),
          optimizer: (projects) => this.#optimizerOff(projects),
          observe: () => this.#policy.observe.runtimeInputs,
          excludeProjects: () => this.#policy.vitest.excludeProjects,
          exclude: () => this.#policy.vitest.exclude,
          childEnv: this.#children.envFor(lane),
          ...(maxWorkers === undefined ? {} : { maxWorkers }),
        });
      const vitestRunner =
        configured.length + configuredPytest.length === 0 || runnerModule.vitestDetected(root)
          ? runnerModule.createRecoveringRunner({
              name: "vitest",
              adapterVersion: vitest.VITEST_ADAPTER_VERSION,
              create: vitestInstance("vitest"),
              onFailure: (text) =>
                this.#note(
                  `${text}; every check of this worktree is unknown until the config loads`,
                ),
              onRecovered: () => this.#note("Vitest started after the config changed"),
              around,
            })
          : null;
      // Spec 004 D2: the slow tier's own Vitest instance, made per slow pass with `slow.maxWorkers`,
      // or `slow.maxParallel` when more, so an idle tier's files run at once (task 004-34).
      const slowWorkers = () =>
        Math.max(this.#policy.slow.maxWorkers, this.#policy.slow.maxParallel);
      const slowVitest = () =>
        runnerModule.createRecoveringRunner({
          name: "vitest",
          adapterVersion: vitest.VITEST_ADAPTER_VERSION,
          create: vitestInstance(`${SLOW_LANE_PREFIX}vitest`, slowWorkers()),
          onFailure: (text) => this.#note(`the slow tier's ${text}`),
          around,
        });
      const nodeTestRunners = nodeTest.createNodeTestRunners(configured, {
        root,
        store,
        tempDir: this.opened.scratch.tempDir,
        childEnv: this.#children.env,
        tierSize: () => this.#policy.runner.tierSize,
        inputs: () => this.#policy.inputs,
        note: (text, topic) => this.#note(text, undefined, undefined, topic),
      });
      // Spec 007 D8: pytest's cache and bytecode live under the state directory (open question 3).
      const pytestRunners = pytest.createPytestRunners(configuredPytest, {
        root,
        store,
        stateDir: storePaths(commonDir).dir,
        tempDir: this.opened.scratch.tempDir,
        childEnv: this.#children.env,
        tierSize: () => this.#policy.runner.tierSize,
        note: (text, topic) => this.#note(text, undefined, undefined, topic),
        latestNote: (topic) =>
          readDaemonNotes(store, this.opened.worktreeId).findLast((n) => n.topic === topic)?.text,
      });
      // Row 011-69: each run, of any lane, is a tier the idle GC waits for.
      const runner = this.#idleGc.track(
        afterEachRun(
          createCompositeRunner([
            ...(vitestRunner === null ? [] : [withSlowInstance(vitestRunner, slowVitest)]),
            ...nodeTestRunners,
            ...pytestRunners,
          ]),
          this.#children,
          ({ text, stopped }) => this.#note(text, stopped),
        ),
      );
      this.#vitest = vitestRunner;
      this.#runner = runner;
      // Task 001-100: while no dependencies are installed nothing loads Vitest, so the
      // first call after the install imports it from the worktree's own `node_modules`.
      // The node:test graphs build here too, off the hook path (review wave 1, inputs).
      await Promise.all([
        ...((await awaitsInstall(root)) ? [] : [vitestRunner?.open()]),
        ...nodeTestRunners.map((r) => r.open()),
        ...pytestRunners.map((r) => r.open()),
      ]);
      if (this.#phase === "stopping" || this.#stopRequested) return;
      const loop = createDaemonLoop({
        root,
        worktreeId,
        store,
        runner,
        sink: createStateSink(store, { now: this.#now }),
        policy: this.#policy,
        reloadPolicy: (changes) =>
          changes.some((change) => change.path === POLICY_FILE) ? this.#reloadPolicy() : null,
        squealVersion: this.#version,
        // Its registration's: the writer of the re-key moves a wait trusts (task 001-268).
        incarnation: this.#incarnation(),
        ...(this.#predecessor === undefined ? {} : { predecessor: this.#predecessor }),
        runsDir: storePaths(commonDir).runsDir,
        describeFailure,
        now: this.#now,
        // Task 001-422: a busy store's error was retried or noted by its subject; no bare note.
        onError: (error) =>
          isBusy(error)
            ? this.#log(`daemon error: ${error.message}`)
            : this.#note(`daemon error: ${error.message}`),
        busySliceMs: BUSY_SLICE_MS,
        busyWaits: this.#busyWaits,
        // Task 001-113: a fresh daemon waits for the install with no runner open.
        onReinstall: (note) => void this.#shutdown("reinstalled", 0, note),
        onDropped: (reason) =>
          this.#note(`watcher dropped events (${reason}); a full reconciliation follows`),
        // Spec 001 D11 Capacity (tasks 001-376, 001-377): backlog and checkpoint tiers share the
        // user's pool, sized from the user's config as read when the loop starts.
        capacity: { dir: slowSlotDir(this.options.env), ...this.#poolCapacity() },
      });
      this.#loop = loop;
      await loop.start();
      // Past the start scan: a registration at a session's start from here on records this
      // daemon as scanned, which "none of the files changed here" needs (D6).
      store.meta.set(bootstrappedMetaKey(worktreeId), String(this.#startedAt));
      // Started: from here a write waits as long as a serving daemon's (task 001-161).
      setBusyTimeout(store, DAEMON_BUSY_TIMEOUT_MS);
      // Idle counts from ready: the baseline is work, and the hook that spawned
      // this daemon registers its consumer while it runs.
      this.#lastActive = this.#now();
      this.#lastUsed = this.#lastActive;
      // The idle GC's quiet too, unless a tier runs.
      this.#idleGc.ready();
      if (this.#phase === "starting") this.#setPhase("ready");
      this.#log(`serving ${root} on ${this.#socketPath}`);
    } catch (error) {
      void this.#shutdown("start-failed", 1, `daemon exited: could not start: ${message(error)}`);
      throw error;
    }
  }

  #openDesk(desk: PreparedDesk): Promise<FrontDesk> {
    return desk.open(
      {
        socketPath: this.#socketPath,
        worktreeId: this.opened.worktreeId,
        root: this.opened.root,
        squealVersion: this.#version,
        startedAt: this.#startedAt,
        token: this.#token,
      },
      {
        requestFullSuite: (request) => this.#requestFullSuite(request),
        requestSlowSuite: () => this.#requestSlowSuite(),
        requestSync: () => this.#requestSync(),
        onActivity: () => {
          this.#lastActive = this.#now();
          this.#lastUsed = this.#lastActive;
        },
        onNudge: () => this.#loop?.scheduler.nudge(),
        requestRetries: () => this.#requestRetries(),
        requestPromotion: (testFiles, withinMs) => this.#requestPromotion(testFiles, withinMs),
        // The tiers stop now, under a shutdown already begun too; the shutdown after the answer.
        onStop: () => {
          this.#cancelTiers("stop");
          setImmediate(
            () => void this.#shutdown("stop-requested", 0, "daemon stopped: squeal stop"),
          );
        },
        // Row 011-31 (C9 as amended 2026-10-20): a step-down cancels its tiers as a stop does.
        onStepDown: (version) => {
          this.#cancelTiers("step-down");
          setImmediate(
            () => void this.#shutdown("superseded", 0, stepDownNote(this.#version, version)),
          );
        },
        onFailure: (error) =>
          void this.#shutdown("start-failed", 1, `daemon exited: socket failed: ${error.message}`),
        // Caught by the desk, which serves on (review wave-13ak, B1).
        onError: (error) => this.#log(`front desk: ${error.message}`),
      },
    );
  }

  #setPhase(phase: DaemonPhase): void {
    this.#phase = phase;
    this.#desk?.setPhase(phase);
  }

  async #requestFullSuite(request: FullSuiteRequest): Promise<FullSuiteCheckpoint> {
    await this.#starting;
    if (this.#loop === null || this.#phase === "stopping") {
      throw new Error("the daemon is not running a scheduler");
    }
    // A runner that never started gets another chance before the checkpoint is planned.
    this.#vitest?.retry();
    return this.#loop.scheduler.requestFullSuite(request);
  }

  /** `squeal retry` (001-368): the stored requests that may run now are queued. */
  async #requestRetries(): Promise<void> {
    await this.#starting;
    if (this.#loop === null || this.#phase === "stopping") return;
    await this.#loop.scheduler.requestRetries();
  }

  /** Spec 011 C15: a named wait promotes its test files for `withinMs`. */
  async #requestPromotion(testFiles: readonly TestFileRef[], withinMs: number): Promise<void> {
    await this.#starting;
    if (this.#loop === null || this.#phase === "stopping") return;
    await this.#loop.scheduler.promote(testFiles, withinMs);
  }

  async #requestSlowSuite(): Promise<SlowSuiteRequested> {
    await this.#starting;
    if (this.#loop === null || this.#phase === "stopping") {
      throw new Error("the daemon is not running a scheduler");
    }
    return requestSlowSuite(this.#loop.scheduler);
  }

  /**
   * Lessons, defect 30: the revision of every change made before the
   * request, once stored. The files a wait holds for are read from the
   * store, once its runner part is applied (`answerMoves`, task 001-258):
   * nothing waits here for the refinement, and nothing is held per request.
   */
  async #requestSync(): Promise<SyncAnswer> {
    await this.#starting;
    if (this.#loop === null || this.#phase === "stopping") {
      throw new Error("the daemon is not running a scheduler");
    }
    await this.#loop.reconcile();
    return { revision: this.#loop.scheduler.status().revision };
  }

  /** What the newest Vitest instance's config turns the optimizer on in (D4, task 001-181). */
  #optimizerOff(projects: readonly string[]): void {
    try {
      recordOptimizerOff(this.opened.store, this.opened.worktreeId, projects);
    } catch (error) {
      this.#log(`could not record the optimizer note: ${String(error)}`);
    }
  }

  /**
   * `stopped`, a stop's processes, goes beside the text for status to fold by
   * (task 001-255); `exitOf`, this daemon's incarnation, on its shutdown's
   * note, so status tells that it left from a death (review wave-13af B1).
   */
  #note(text: string, stopped?: StoppedProcesses, exitOf?: string, topic?: string): void {
    this.#log(text);
    const revision = this.#loop?.scheduler.status().revision ?? null;
    const note = {
      text,
      ...(stopped === undefined ? {} : { stopped }),
      ...(exitOf === undefined ? {} : { exitOf }),
      ...(topic === undefined ? {} : { topic }),
    };
    writeNote(
      this.opened.store,
      this.opened.worktreeId,
      { at: this.#now(), revision, ...note },
      () => {},
    );
  }

  /**
   * D10 as amended (task 001-367; row 011-31, C9 as amended 2026-10-20): a
   * `squeal stop` or a step-down cancels the tiers in flight in every lane,
   * as a timeout stops one, and no other starts. A
   * runner that cannot cancel (node:test, pytest) has its processes, every
   * carrier of this daemon's mark, stopped after `CANCEL_GRACE_MS` (D12), so
   * its run ends; what did not complete stays queued for the next daemon.
   */
  #cancelTiers(cause: "stop" | "step-down"): void {
    if (this.#stopRequested) return;
    this.#stopRequested = true;
    const loop = this.#loop;
    if (loop === null) return;
    const closed = loop.close({ cancel: true, cause }).then(
      () => true,
      () => true,
    );
    this.#cancelling = (async () => {
      const grace = sleep(CANCEL_GRACE_MS, false, { ref: false });
      if (await Promise.race([closed, grace])) return;
      const stop = await this.#children.stopMarked().catch(() => null);
      if (stop !== null) this.#note(stop.text, stop.stopped);
    })();
  }

  /**
   * Spec 001 D10 and the review's shutdown order: `loop.close()` (waits for
   * the tier in flight, abandons the open checkpoint; cancels it after a
   * stop or a step-down, `#cancelTiers`), `runner.close()`, what
   * the tests left running (D12), the
   * temp directory once its leftovers are gone, `setDaemon(null)`,
   * `store.close()`. Then the socket, which closing unlinks, and last the
   * lock, so a successor never sees this daemon's socket go away after
   * binding its own.
   */
  #shutdown(reason: DaemonExitReason, code: 0 | 1, text: string): Promise<DaemonExit> {
    this.#exit ??= (async () => {
      this.#setPhase("stopping");
      this.#stopTimers();
      this.#markExit();
      this.#note(text, undefined, this.#incarnation());
      await this.#starting.catch(() => {});
      const { store, worktreeId, lock } = this.opened;
      await this.#step("loop.close", async () => {
        await this.#loop?.close(this.#stopRequested ? { cancel: true } : {});
        await this.#cancelling;
      });
      await this.#step("runner.close", () => this.#runner?.close());
      await this.#step("escaped children", async () => {
        const stop = await this.#children.atExit();
        if (stop !== null) this.#note(stop.text, stop.stopped);
      });
      await this.#step("temp dir removal", async () => {
        await this.opened.leftovers;
        removeScratch(this.opened.scratch);
      });
      await this.#step("setDaemon", () => store.worktrees.setDaemon(worktreeId, null));
      await this.#step("store.close", () => store.close());
      await this.#step("socket close", () => this.#desk?.close());
      pauseAt("stop-gap");
      await this.#step("lock release", () => lock.release());
      const result = exit(reason, code, text);
      this.#resolveExit(result);
      return result;
    })();
    return this.#exit;
  }

  /**
   * Its shutdown's mark, before anything it awaits, which status reads to tell
   * a kill from here on from a death (`withDeath`, task 001-274). A store
   * that cannot take it costs the log line, as a note's does. A daemon not
   * yet registered writes none: a start that fails first leaves no row, which
   * no worktree record would let prune reach (task 001-276). Nor does one
   * whose row a prune took while it ran, checked in the write's transaction
   * (task 001-278).
   */
  #markExit(): void {
    if (!this.#registered) return;
    const { store, worktreeId } = this.opened;
    try {
      store.transaction(() => {
        if (store.worktrees.get(worktreeId) === null) return;
        store.meta.set(daemonExitMetaKey(worktreeId), this.#incarnation());
      });
    } catch (error) {
      this.#log(`could not mark the shutdown: ${message(error)}`);
    }
  }

  async #step(name: string, fn: () => unknown): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.#log(`shutdown: ${name} failed: ${message(error)}`);
    }
  }
}
