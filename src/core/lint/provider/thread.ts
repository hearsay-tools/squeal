import { Worker } from "node:worker_threads";
import type { AbsolutePath } from "../../types/common.js";
import { type FromWorker, firstLine, type WorkerAnswer, type WorkerCall } from "./protocol.js";

/*
 * Spec 017 D3, D9: one ESLint worker thread seen from the daemon's thread.
 * A call that sees no progress within its guard terminates the thread; a
 * thread that throws or exits fails the call in hand, or tells `onIdle`
 * when none is. A failed thread is not used again.
 */

/** The thread failed: it timed out, threw or exited. `message` is D9's reason. */
export class ThreadFailure extends Error {}

/** A call the worker answered with an error and lived on, as a config that does not load. */
export class CallError extends Error {}

export interface ThreadOptions {
  readonly script: string;
  readonly root: AbsolutePath;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** A failure while no call is in hand, as a plugin's late timer that throws. */
  readonly onIdle: (reason: string) => void;
}

interface Pending {
  readonly id: number;
  readonly guardMs: number;
  timer: NodeJS.Timeout;
  resolve(answer: WorkerAnswer): void;
  reject(error: Error): void;
}

export class LintThread {
  private readonly worker: Worker;
  private pending: Pending | null = null;
  private failed: string | null = null;
  private calls = 0;

  constructor(private readonly options: ThreadOptions) {
    this.worker = new Worker(options.script, {
      workerData: { root: options.root },
      env: { ...options.env },
      execArgv: [],
      stdout: true,
      stderr: true,
    });
    // A plugin's output is not the daemon's; it is read and dropped.
    this.worker.stdout.resume();
    this.worker.stderr.resume();
    this.worker.unref();
    this.worker.on("message", (message: FromWorker) => this.heard(message));
    this.worker.on("error", (error) => this.fail(`the ESLint worker threw: ${firstLine(error)}`));
    this.worker.on("messageerror", (error) =>
      this.fail(`the ESLint worker threw: ${firstLine(error)}`),
    );
    this.worker.on("exit", (code) => this.fail(`the ESLint worker exited with code ${code}`));
  }

  get alive(): boolean {
    return this.failed === null;
  }

  /** One call at a time; rejects with `ThreadFailure` or `CallError`. */
  call(message: WorkerCall, guardMs: number): Promise<WorkerAnswer> {
    if (this.failed !== null) return Promise.reject(new ThreadFailure(this.failed));
    if (this.pending !== null) return Promise.reject(new Error("a lint call is in hand"));
    const id = ++this.calls;
    return new Promise((resolve, reject) => {
      this.pending = { id, guardMs, timer: this.guard(guardMs), resolve, reject };
      this.worker.postMessage({ ...message, id });
    });
  }

  async terminate(): Promise<void> {
    this.fail("the ESLint worker was stopped");
    await this.worker.terminate();
  }

  private guard(ms: number): NodeJS.Timeout {
    return setTimeout(() => {
      this.fail(`timed out after ${ms / 1000} s`);
      void this.worker.terminate();
    }, ms);
  }

  private heard(message: FromWorker): void {
    const pending = this.pending;
    if (pending === null || message.id !== pending.id) return;
    clearTimeout(pending.timer);
    if (message.type === "progress") {
      pending.timer = this.guard(pending.guardMs);
      return;
    }
    this.pending = null;
    if (message.type === "done") pending.resolve(message.answer);
    else pending.reject(new CallError(message.message));
  }

  private fail(reason: string): void {
    if (this.failed !== null) return;
    this.failed = reason;
    const pending = this.pending;
    this.pending = null;
    if (pending === null) {
      if (reason !== "the ESLint worker was stopped") this.options.onIdle(reason);
      return;
    }
    clearTimeout(pending.timer);
    pending.reject(new ThreadFailure(reason));
  }
}
