import { type ChildProcess, spawn } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readSync,
  rmSync,
  statSync,
} from "node:fs";
import { totalmem } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { lowerProcess } from "../../../core/daemon/low-priority.js";
import type { AbsolutePath } from "../../../core/types/common.js";
import { OBSERVE_VARIABLE } from "../../observe/runtime.js";
import type { ProcessExit } from "../../process/group.js";
import type { JestInstall } from "../resolve.js";

/** SIGKILL follows SIGTERM after this long (D4.2). */
export const KILL_GRACE_MS = 2_000;

/** D7.4: an idle warm worker exits after this long. */
export const DEFAULT_WARM_IDLE_MS = 60_000;

/** A `shutdown` message gets this long before SIGTERM. */
const SHUTDOWN_GRACE_MS = 1_000;
/** The end of a worker's stderr a failed batch's own log gets. */
const TAIL_BYTES = 4_096;
const MIB = 1024 * 1024;

/**
 * D7.2: the resident memory above which a warm worker is replaced after its
 * batch: `min(1024 MiB, 10% of the machine's memory)`, at least 256 MiB.
 */
export function defaultWarmMemoryLimitBytes(total: number = totalmem()): number {
  return Math.max(256, Math.min(1024, Math.floor(total / (10 * MIB)))) * MIB;
}

/** What a warm worker starts with; a worker serves only batches of the same start. */
export interface WarmStart {
  readonly workerPath: AbsolutePath;
  readonly install: JestInstall;
  /** Jest's working directory, absolute. */
  readonly cwd: AbsolutePath;
  readonly wrapperPath: AbsolutePath;
  /** Jest's `cacheDirectory`. */
  readonly jestCacheDir: AbsolutePath;
  readonly reporterPath: string;
  /** D5.3: the worker runs with V8 coverage. */
  readonly coverage: boolean;
  /** The recorder is in `env`; its output folder there is the first batch's, and moves per batch. */
  readonly observing: boolean;
  /** The worker's environment, without any run's marks: those go in each batch's `env`. */
  readonly env: NodeJS.ProcessEnv;
  /** Where the workers' stdout and stderr logs go while they live. */
  readonly logDir: AbsolutePath;
}

/** One batch for a warm worker. */
export interface WarmBatch {
  readonly files: readonly AbsolutePath[];
  readonly eventsFile: string;
  readonly coverageDir: string | null;
  /** The recorder's folder and skipped prefixes for this batch, when the worker observes. */
  readonly observe?: { readonly out: string; readonly skip: readonly string[] };
  /** Over the worker's environment for this batch only: what its tests start carries them. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The batch's stderr log: a failure's words and the end of the worker's stderr go there. */
  readonly stderr: string;
}

/** A batch on a warm worker, as `startGroup` gives a batch process. */
export interface WarmRun {
  /** The worker's pid; undefined when it could not start. */
  readonly pid: number | undefined;
  readonly exited: Promise<ProcessExit>;
  /** Signals the worker's whole group; the worker is not used again. */
  kill(signal: NodeJS.Signals): void;
}

export interface JestWarmPoolOptions {
  /** D7.2, read after each batch; default `defaultWarmMemoryLimitBytes()`. */
  readonly memoryLimitBytes?: () => number;
  /** D7.4; default `DEFAULT_WARM_IDLE_MS`. */
  readonly idleMs?: number;
  /** Idle workers kept, read as one goes idle (the tier size); default every one. */
  readonly keep?: () => number;
}

type Reply =
  | { readonly type: "ready"; readonly pid: number; readonly rssBytes: number }
  | { readonly type: "done"; readonly id: number; readonly rssBytes: number }
  | { readonly type: "error"; readonly id: number | null; readonly message: string };

type State = "busy" | "idle" | "closing";

class WarmWorker {
  readonly child: ChildProcess;
  readonly signature: string;
  readonly exited: Promise<ProcessExit>;
  /** `null` once it is ready, else why it is not. */
  readonly ready: Promise<string | null>;
  readonly stderrLog: string;
  state: State = "busy";
  /** Not used again: a recycle came while it ran. */
  retired = false;
  idleTimer: NodeJS.Timeout | null = null;
  usedAt = 0;
  #gone = false;

  constructor(start: WarmStart, signature: string, name: string) {
    mkdirSync(start.logDir, { recursive: true });
    const base = join(start.logDir, name);
    this.stderrLog = `${base}.err.log`;
    const out = openSync(`${base}.out.log`, "w");
    const err = openSync(this.stderrLog, "w");
    this.signature = signature;
    this.child = spawn(process.execPath, [start.workerPath], {
      cwd: start.cwd,
      env: start.env,
      detached: true,
      stdio: ["ignore", out, err, "ipc"],
    });
    closeSync(out);
    closeSync(err);
    if (this.child.pid !== undefined) lowerProcess(this.child.pid);
    this.exited = new Promise((resolve) => {
      this.child.once("error", (error) => {
        this.#gone = true;
        resolve({ code: null, signal: null, error: error.message });
      });
      this.child.once("exit", (code, signal) => {
        // What its tests left in its group goes with it, as `startGroup` does.
        this.kill("SIGKILL");
        this.#gone = true;
        resolve({ code, signal, error: null });
      });
    });
    // Removed once whoever reads the stderr of the exit has read it.
    void this.exited.then(() =>
      setImmediate(() => {
        for (const log of [`${base}.out.log`, this.stderrLog]) rmSync(log, { force: true });
      }),
    );
    this.send({
      type: "init",
      cwd: start.cwd,
      wrapperPath: start.wrapperPath,
      cacheDir: start.jestCacheDir,
      coreDir: start.install.core,
      configDir: start.install.config,
      runtimeDir: start.install.runtime,
      reporterPath: start.reporterPath,
      coverage: start.coverage,
    });
    this.ready = this.reply((m) => m.type === "ready" || m.type === "error").then((m) => {
      if (m === null) return "it exited while it started";
      return m.type === "error" ? m.message : null;
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  get gone(): boolean {
    return this.#gone;
  }

  send(message: object): boolean {
    try {
      return this.child.connected && this.child.send(message);
    } catch {
      return false;
    }
  }

  /** The first message `accept` takes; `null` when the worker exits first. */
  reply(accept: (message: Reply) => boolean): Promise<Reply | null> {
    return new Promise((resolve) => {
      const onMessage = (message: unknown) => {
        if (!isReply(message) || !accept(message)) return;
        this.child.off("message", onMessage);
        resolve(message);
      };
      this.child.on("message", onMessage);
      void this.exited.then(() => {
        this.child.off("message", onMessage);
        resolve(null);
      });
    });
  }

  kill(signal: NodeJS.Signals): void {
    if (this.child.pid === undefined || this.#gone) return;
    try {
      process.kill(-this.child.pid, signal);
    } catch {
      // the group is already gone
    }
  }

  /** Whether this process waits for it: while it runs, yes; while idle, no. */
  hold(held: boolean): void {
    const channel = this.child.channel as { ref?(): void; unref?(): void } | null | undefined;
    if (held) {
      this.child.ref();
      channel?.ref?.();
    } else {
      this.child.unref();
      channel?.unref?.();
    }
  }
}

function isReply(message: unknown): message is Reply {
  return typeof message === "object" && message !== null && "type" in message;
}

/** Same start, same worker: `observing` stands for the recorder's settings, whose folder moves per batch. */
function signatureOf(start: WarmStart): string {
  const env = Object.entries(start.env)
    .filter(([key, value]) => key !== OBSERVE_VARIABLE && value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([
    start.workerPath,
    start.install.core,
    start.cwd,
    start.wrapperPath,
    start.jestCacheDir,
    start.reporterPath,
    start.coverage,
    start.observing,
    env,
  ]);
}

/** The last `TAIL_BYTES` of `file`, or "". */
function tail(file: string): string {
  try {
    const size = statSync(file).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    const fd = openSync(file, "r");
    try {
      readSync(fd, buffer, 0, length, size - length);
    } finally {
      closeSync(fd);
    }
    return buffer.toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Spec 028 D7: warm Jest workers (`warm-worker.cjs`) for one project. A
 * batch takes an idle worker of the same start (`WarmStart`), else starts
 * one, which reads the config and builds the haste map once. After a batch
 * a worker above the memory limit, or one a `recycle` retired, is shut
 * down; the others wait, idle, until the next batch, `idleMs`, or `close`.
 * A killed or crashed worker is never used again. An idle worker does not
 * keep this process alive.
 */
export class JestWarmPool {
  readonly #workers = new Set<WarmWorker>();
  readonly #options: JestWarmPoolOptions;
  #batches = 0;
  #started = 0;

  constructor(options: JestWarmPoolOptions = {}) {
    this.#options = options;
  }

  /** The live workers' pids, for tests and logs. */
  pids(): number[] {
    return [...this.#workers].flatMap((w) => (w.pid === undefined || w.gone ? [] : [w.pid]));
  }

  run(start: WarmStart, batch: WarmBatch): WarmRun {
    const signature = signatureOf(start);
    let worker = [...this.#workers].find((w) => w.state === "idle" && w.signature === signature);
    if (worker === undefined) worker = this.#start(start, signature);
    else if (worker.idleTimer !== null) clearTimeout(worker.idleTimer);
    worker.state = "busy";
    worker.hold(true);
    const exited = this.#runOn(worker, batch);
    const used = worker;
    return {
      pid: worker.pid,
      exited,
      kill: (signal) => {
        used.retired = true;
        used.kill(signal);
      },
    };
  }

  /** D7.3: no worker is used again; idle ones exit now, busy ones after their batch. */
  async recycle(): Promise<void> {
    const closing: Promise<ProcessExit>[] = [];
    for (const worker of this.#workers) {
      worker.retired = true;
      if (worker.state === "idle") closing.push(this.#shutdown(worker));
    }
    await Promise.all(closing);
  }

  /** Every worker exits: idle ones asked to, busy ones killed. */
  async close(): Promise<void> {
    const closing: Promise<ProcessExit>[] = [];
    for (const worker of this.#workers) {
      worker.retired = true;
      if (worker.state === "busy") {
        worker.kill("SIGTERM");
        closing.push(this.#killLater(worker));
      } else closing.push(this.#shutdown(worker));
    }
    await Promise.all(closing);
  }

  #start(start: WarmStart, signature: string): WarmWorker {
    const worker = new WarmWorker(start, signature, `warm-${process.pid}-${++this.#started}`);
    this.#workers.add(worker);
    void worker.exited.then(() => this.#workers.delete(worker));
    return worker;
  }

  async #runOn(worker: WarmWorker, batch: WarmBatch): Promise<ProcessExit> {
    const failed = await worker.ready;
    const id = ++this.#batches;
    const reply = failed === null ? await this.#batch(worker, batch, id) : null;
    if (reply?.type === "done") {
      const limit = this.#options.memoryLimitBytes?.() ?? defaultWarmMemoryLimitBytes();
      if (worker.retired || reply.rssBytes > limit) void this.#shutdown(worker);
      else this.#idle(worker);
      return { code: 0, signal: null, error: null };
    }
    return this.#ended(worker, batch, failed ?? (reply?.type === "error" ? reply.message : null));
  }

  /** Sends the batch; its `done` or `error`, or `null` when the worker is gone first. */
  #batch(worker: WarmWorker, batch: WarmBatch, id: number): Promise<Reply | null> {
    const sent = worker.send({
      type: "run",
      id,
      files: batch.files,
      eventsFile: batch.eventsFile,
      coverageDir: batch.coverageDir,
      observeOut: batch.observe?.out ?? null,
      observeSkip: batch.observe?.skip ?? null,
      env: batch.env,
    });
    if (!sent) return Promise.resolve(null);
    return worker.reply((m) => (m.type === "done" || m.type === "error") && m.id === id);
  }

  /** An error, an exit or a kill: the worker is never used again, and the batch ends with its exit. */
  async #ended(worker: WarmWorker, batch: WarmBatch, message: string | null): Promise<ProcessExit> {
    worker.retired = true;
    if (!worker.gone) void this.#killLater(worker);
    const exit = await worker.exited;
    this.#note(batch.stderr, worker, message);
    const first = message?.split("\n")[0] ?? null;
    return first === null || exit.error !== null ? exit : { ...exit, error: first };
  }

  #idle(worker: WarmWorker): void {
    worker.state = "idle";
    worker.usedAt = performance.now();
    worker.hold(false);
    const idleMs = this.#options.idleMs ?? DEFAULT_WARM_IDLE_MS;
    worker.idleTimer = setTimeout(() => void this.#shutdown(worker), idleMs);
    worker.idleTimer.unref();
    const keep = Math.max(1, this.#options.keep?.() ?? Number.POSITIVE_INFINITY);
    const idle = [...this.#workers]
      .filter((w) => w.state === "idle")
      .sort((a, b) => a.usedAt - b.usedAt);
    for (const extra of idle.slice(0, Math.max(0, idle.length - keep))) void this.#shutdown(extra);
  }

  /** Asks the worker to exit; SIGTERM to its group after a grace, then SIGKILL. */
  #shutdown(worker: WarmWorker): Promise<ProcessExit> {
    if (worker.state === "closing") return worker.exited;
    worker.state = "closing";
    worker.hold(true);
    if (worker.idleTimer !== null) clearTimeout(worker.idleTimer);
    worker.send({ type: "shutdown" });
    return (async () => {
      const timeout = sleep(SHUTDOWN_GRACE_MS, null, { ref: false });
      if ((await Promise.race([worker.exited, timeout])) === null) {
        worker.kill("SIGTERM");
        return this.#killLater(worker);
      }
      return worker.exited;
    })();
  }

  /** SIGKILL to the worker's group when it is still there after `KILL_GRACE_MS`. */
  async #killLater(worker: WarmWorker): Promise<ProcessExit> {
    const timeout = sleep(KILL_GRACE_MS, null, { ref: false });
    if ((await Promise.race([worker.exited, timeout])) === null) worker.kill("SIGKILL");
    return worker.exited;
  }

  /** The failure's words and the end of the worker's stderr, in the batch's own stderr log. */
  #note(stderr: string, worker: WarmWorker, message: string | null): void {
    const text = [
      `squeal: warm jest worker ${worker.pid ?? "(not started)"} ended its batch abnormally`,
      ...(message === null ? [] : [message]),
      tail(worker.stderrLog),
    ].join("\n");
    try {
      appendFileSync(stderr, `${text}\n`);
    } catch {
      // the run's log folder is gone
    }
  }
}
