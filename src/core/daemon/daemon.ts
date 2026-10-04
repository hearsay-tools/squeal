import type { DaemonLoop } from "../daemon-loop/index.js";
import type {
  AbsolutePath,
  CheckpointRecord,
  DaemonExit,
  DaemonExitReason,
  DaemonPhase,
  EpochMs,
  Policy,
  WorktreeId,
} from "../types/index.js";
import { type FrontDesk, type PreparedDesk, prepareFrontDesk } from "./desk.js";
import { type DaemonTimings, startTimers } from "./lifecycle.js";
import { writeNote } from "./notes.js";
import { exit, message, type OpenedDaemon, openDaemon } from "./open.js";
import { linkedWorktreeDir, socketPathFor } from "./paths.js";
import { loadPolicy } from "./policy.js";
import type { RecoveringRunner } from "./runner.js";
import { squealVersion } from "./version.js";

export type { DaemonTimings } from "./lifecycle.js";

export interface DaemonOptions {
  /** The worktree root; resolved with realpath. */
  readonly root: string;
  /** For the runtime dir of the socket (D1). Default `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => EpochMs;
  /** One line per event, for the foreground process's stderr. */
  readonly log?: (line: string) => void;
  readonly timings?: Partial<DaemonTimings>;
}

/** A daemon that owns its worktree: lock held, socket bound, worktree registered. */
export interface RunningDaemon {
  readonly root: AbsolutePath;
  readonly worktreeId: WorktreeId;
  readonly socketPath: AbsolutePath;
  /** Settles once the scheduler started (baseline lookup done, watcher on) or the daemon gave up. */
  readonly ready: Promise<void>;
  readonly exited: Promise<DaemonExit>;
  /** Shuts down in the D10 order: loop, runner, `setDaemon(null)`, store, socket, lock. */
  stop(reason: Extract<DaemonExitReason, "stop-requested" | "signal">): Promise<DaemonExit>;
}

/**
 * Starts the daemon of one worktree. Spec 001 D10 and the start order of the
 * wave 2 review inputs: worktree, store and lock (`openDaemon`), then the
 * socket, which answers pings from here on; the worktree row and the daemon
 * record; the policy; the runner, the state sink and the daemon loop, loaded
 * only now so the socket is up within the hooks' spawn budget. Returns a
 * `DaemonExit` when this process must not serve: not a worktree, store
 * newer or unusable, lock lost.
 */
export async function startDaemon(options: DaemonOptions): Promise<RunningDaemon | DaemonExit> {
  const now = options.now ?? Date.now;
  const desk = prepareFrontDesk();
  const opened = await openDaemon(options.root, now);
  if ("reason" in opened) {
    desk.discard();
    return opened;
  }
  return new Daemon(opened, options).start(desk);
}

class Daemon {
  readonly #log: (line: string) => void;
  readonly #now: () => EpochMs;
  readonly #socketPath: AbsolutePath;
  readonly #startedAt: EpochMs;
  readonly #version = squealVersion();
  #phase: DaemonPhase = "starting";
  #desk: FrontDesk | null = null;
  #runner: RecoveringRunner | null = null;
  #loop: DaemonLoop | null = null;
  #starting: Promise<void> = Promise.resolve();
  #stopTimers: () => void = () => {};
  #lastActive: EpochMs;
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
  }

  async start(desk: PreparedDesk): Promise<RunningDaemon | DaemonExit> {
    const { root, worktreeId } = this.opened;
    try {
      this.#desk = await this.#openDesk(desk);
      this.#register();
    } catch (error) {
      return this.#shutdown("start-failed", 1, `could not start serving: ${message(error)}`);
    }
    let policy: Policy;
    try {
      policy = loadPolicy(root);
    } catch (error) {
      this.#shutdown("bad-policy", 1, `daemon exited: ${message(error)}`);
      return this.#exited;
    }
    this.#stopTimers = startTimers({
      ...this.opened,
      policy,
      now: this.#now,
      linkedDir: linkedWorktreeDir(root),
      timings: this.options.timings ?? {},
      heartbeatMs: this.#heartbeatMs(),
      lastActive: () => this.#lastActive,
      active: (at) => {
        this.#lastActive = at;
      },
      note: (text) => this.#note(text),
      log: this.#log,
      shutdown: (reason, text) => void this.#shutdown(reason, 0, text),
    });
    this.#starting = this.#run(policy);
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
  async #run(policy: Policy): Promise<void> {
    const { root, worktreeId, store, commonDir } = this.opened;
    try {
      const [{ createDaemonLoop }, { createStateSink, describeFailure }, vitest, runnerModule] =
        await Promise.all([
          import("../daemon-loop/index.js"),
          import("../state/index.js"),
          import("../../runners/vitest/index.js"),
          import("./runner.js"),
        ]);
      const { storePaths } = await import("../store/index.js");
      const runner = runnerModule.createRecoveringRunner({
        name: "vitest",
        adapterVersion: vitest.VITEST_ADAPTER_VERSION,
        create: () => vitest.createVitestAdapter({ root }),
        onFailure: (text) =>
          this.#note(`${text}; every check of this worktree is unknown until the config loads`),
        onRecovered: () => this.#note("Vitest started after the config changed"),
      });
      this.#runner = runner;
      await runner.open();
      if (this.#phase === "stopping") return;
      const loop = createDaemonLoop({
        root,
        worktreeId,
        store,
        runner,
        sink: createStateSink(store, { now: this.#now }),
        policy,
        squealVersion: this.#version,
        runsDir: storePaths(commonDir).runsDir,
        describeFailure,
        now: this.#now,
        onError: (error) => this.#note(`daemon error: ${error.message}`),
        onDropped: (reason) =>
          this.#note(`watcher dropped events (${reason}); a full reconciliation follows`),
      });
      this.#loop = loop;
      await loop.start();
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
        onActivity: () => {
          this.#lastActive = this.#now();
        },
        // After the answer is written.
        onStop: () =>
          setImmediate(
            () => void this.#shutdown("stop-requested", 0, "daemon stopped: squeal stop"),
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
    this.#runner?.retry();
    return this.#loop.scheduler.requestFullSuite({ force });
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
   * the tier in flight, abandons the open checkpoint), `runner.close()`,
   * `setDaemon(null)`, `store.close()`. Then the socket, which closing
   * unlinks, and last the lock, so a successor never sees this daemon's
   * socket go away after binding its own.
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
