import type { DaemonLoop } from "../daemon-loop/index.js";
import { linkedWorktreeDir } from "../fs/index.js";
import type {
  AbsolutePath,
  CheckpointRecord,
  DaemonExit,
  DaemonExitReason,
  DaemonPhase,
  EpochMs,
  Policy,
  RunnerAdapter,
  WorktreeId,
} from "../types/index.js";
import { bootstrappedMetaKey, DEFAULT_POLICY, SLOW_LANE_PREFIX } from "../types/index.js";
import { type FrontDesk, type PreparedDesk, prepareFrontDesk } from "./desk.js";
import { afterEachRun, EscapedChildren } from "./escaped.js";
import {
  type DaemonTimings,
  type ObservedSeen,
  type Presence,
  startTimers,
  stepDownNote,
} from "./lifecycle.js";
import { writeNote } from "./notes.js";
import { abandon, exit, message, type OpenedDaemon, openDaemon } from "./open.js";
import { prepareSocketDir, socketPathFor } from "./paths.js";
import { describeProblems, lastPolicyNote, loadPolicy, POLICY_FILE } from "./policy.js";
import { requestSlowSuite, type SlowSuiteRequested } from "./run-slow.js";
import type { RecoveringRunner } from "./runner.js";
import { adoptScratch, inRootWhileRunning, removeScratch } from "./scratch.js";
import { squealVersion } from "./version.js";

export type { DaemonTimings } from "./lifecycle.js";

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

class Daemon {
  readonly #log: (line: string) => void;
  readonly #now: () => EpochMs;
  readonly #socketPath: AbsolutePath;
  readonly #startedAt: EpochMs;
  readonly #version = squealVersion();
  #phase: DaemonPhase = "starting";
  #policy: Policy = DEFAULT_POLICY;
  #desk: FrontDesk | null = null;
  #runner: RunnerAdapter | null = null;
  /** The Vitest part of `#runner`, which `run --all` asks to retry its creation. */
  #vitest: RecoveringRunner | null = null;
  #loop: DaemonLoop | null = null;
  /** What its tests leave running, stopped after each tier and at exit (D12). */
  readonly #children = new EscapedChildren();
  #starting: Promise<void> = Promise.resolve();
  #stopTimers: () => void = () => {};
  #lastActive: EpochMs;
  readonly #presence: Presence;
  /** Task 003-42: a timer restart starts from the snapshot its predecessor took. */
  readonly #observedSeen: ObservedSeen = {};
  #exit: Promise<DaemonExit> | null = null;
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
    this.#presence = { since: this.#startedAt, lastPresentAt: null };
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
      // Task 003-26: queued runner work, never activity; until the scheduler takes it, asked again.
      observedChanged: () =>
        this.#loop !== null && this.#phase !== "stopping" && this.#loop.scheduler.refreshObserved(),
      observedSeen: this.#observedSeen,
      // Task 004-29: the last session's departure drains these before the exit.
      slowPending: () =>
        this.#loop !== null && this.#phase !== "stopping" && this.#loop.scheduler.slowPending(),
      note: (text) => this.#note(text),
      log: this.#log,
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

  /** Review wave 2 input 4: `worktrees.upsert`, then `setDaemon` with the socket and a heartbeat. */
  #register(): void {
    const { store, worktreeId: id, root, commonDir } = this.opened;
    store.transaction(() => {
      const existing = store.worktrees.get(id);
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
      });
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
        runnerModule,
        { createCompositeRunner },
        { withSlowInstance },
        { awaitsInstall },
      ] = await Promise.all([
        import("../daemon-loop/index.js"),
        import("../state/index.js"),
        import("../../runners/vitest/index.js"),
        import("./node-test-runners.js"),
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
      // Each Vitest instance's workers carry the mark of its lane (001 D12, task 004-18).
      const vitestInstance = (lane: string, maxWorkers?: number) => () =>
        vitest.createVitestAdapter({
          root,
          note: (text) => this.#note(text),
          observe: () => this.#policy.observe.runtimeInputs,
          childEnv: this.#children.envFor(lane),
          ...(maxWorkers === undefined ? {} : { maxWorkers }),
        });
      const vitestRunner =
        configured.length === 0 || runnerModule.vitestDetected(root)
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
      // Spec 004 D2: the slow tier's own Vitest instance, made per slow pass with `slow.maxWorkers`.
      const slowVitest = () =>
        runnerModule.createRecoveringRunner({
          name: "vitest",
          adapterVersion: vitest.VITEST_ADAPTER_VERSION,
          create: vitestInstance(`${SLOW_LANE_PREFIX}vitest`, this.#policy.slow.maxWorkers),
          onFailure: (text) => this.#note(`the slow tier's ${text}`),
          around,
        });
      const nodeTestRunners = nodeTest.createNodeTestRunners(configured, {
        root,
        store,
        tempDir: this.opened.scratch.tempDir,
        childEnv: this.#children.env,
        tierSize: () => this.#policy.runner.tierSize,
        note: (text) => this.#note(text),
      });
      const runner = afterEachRun(
        createCompositeRunner([
          ...(vitestRunner === null ? [] : [withSlowInstance(vitestRunner, slowVitest)]),
          ...nodeTestRunners,
        ]),
        this.#children,
        (text) => this.#note(text),
      );
      this.#vitest = vitestRunner;
      this.#runner = runner;
      // Task 001-100: while no dependencies are installed nothing loads Vitest, so the
      // first call after the install imports it from the worktree's own `node_modules`.
      // The node:test graphs build here too, off the hook path (review wave 1, inputs).
      await Promise.all([
        ...((await awaitsInstall(root)) ? [] : [vitestRunner?.open()]),
        ...nodeTestRunners.map((r) => r.open()),
      ]);
      if (this.#phase === "stopping") return;
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
        runsDir: storePaths(commonDir).runsDir,
        describeFailure,
        now: this.#now,
        onError: (error) => this.#note(`daemon error: ${error.message}`),
        // Task 001-113: a fresh daemon waits for the install with no runner open.
        onReinstall: (note) => void this.#shutdown("reinstalled", 0, note),
        onDropped: (reason) =>
          this.#note(`watcher dropped events (${reason}); a full reconciliation follows`),
      });
      this.#loop = loop;
      await loop.start();
      // Past the start scan: a registration at a session's start from here on records this
      // daemon as scanned, which "none of the files changed here" needs (D6).
      store.meta.set(bootstrappedMetaKey(worktreeId), String(this.#startedAt));
      // Idle counts from ready: the baseline is work, and the hook that spawned
      // this daemon registers its consumer while it runs.
      this.#lastActive = this.#now();
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
      },
      {
        requestFullSuite: (force) => this.#requestFullSuite(force),
        requestSlowSuite: () => this.#requestSlowSuite(),
        onActivity: () => {
          this.#lastActive = this.#now();
        },
        // After the answer is written.
        onStop: () =>
          setImmediate(
            () => void this.#shutdown("stop-requested", 0, "daemon stopped: squeal stop"),
          ),
        onStepDown: (version) =>
          setImmediate(
            () => void this.#shutdown("superseded", 0, stepDownNote(this.#version, version)),
          ),
        onFailure: (error) =>
          void this.#shutdown("start-failed", 1, `daemon exited: socket failed: ${error.message}`),
      },
    );
  }

  #setPhase(phase: DaemonPhase): void {
    this.#phase = phase;
    this.#desk?.setPhase(phase);
  }

  async #requestFullSuite(force: boolean): Promise<CheckpointRecord> {
    await this.#starting;
    if (this.#loop === null || this.#phase === "stopping") {
      throw new Error("the daemon is not running a scheduler");
    }
    // A runner that never started gets another chance before the checkpoint is planned.
    this.#vitest?.retry();
    return this.#loop.scheduler.requestFullSuite({ force });
  }

  async #requestSlowSuite(): Promise<SlowSuiteRequested> {
    await this.#starting;
    if (this.#loop === null || this.#phase === "stopping") {
      throw new Error("the daemon is not running a scheduler");
    }
    return requestSlowSuite(this.#loop.scheduler);
  }

  #note(text: string): void {
    this.#log(text);
    const revision = this.#loop?.scheduler.status().revision ?? null;
    writeNote(
      this.opened.store,
      this.opened.worktreeId,
      { at: this.#now(), revision, text },
      () => {},
    );
  }

  /**
   * Spec 001 D10 and the review's shutdown order: `loop.close()` (waits for
   * the tier in flight, abandons the open checkpoint), `runner.close()`, what
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
      this.#note(text);
      await this.#starting.catch(() => {});
      const { store, worktreeId, lock } = this.opened;
      await this.#step("loop.close", () => this.#loop?.close());
      await this.#step("runner.close", () => this.#runner?.close());
      await this.#step("escaped children", async () => {
        const text = await this.#children.atExit();
        if (text !== null) this.#note(text);
      });
      await this.#step("temp dir removal", async () => {
        await this.opened.leftovers;
        removeScratch(this.opened.scratch);
      });
      await this.#step("setDaemon", () => store.worktrees.setDaemon(worktreeId, null));
      await this.#step("store.close", () => store.close());
      await this.#step("socket close", () => this.#desk?.close());
      await this.#step("lock release", () => lock.release());
      const result = exit(reason, code, text);
      this.#resolveExit(result);
      return result;
    })();
    return this.#exit;
  }

  async #step(name: string, fn: () => unknown): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.#log(`shutdown: ${name} failed: ${message(error)}`);
    }
  }
}
