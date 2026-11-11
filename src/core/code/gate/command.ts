import { spawn } from "node:child_process";

/*
 * Spec 020 D15.3 (row 020-16b, review 0.1.432 B1): one command run in its
 * own process group under a timeout, as a node:test entry's `prepare`
 * runs, with the gate's cancel signals passed on to the group.
 */

/** How a command run ended. */
export interface Ended {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  /** It could not start, such as a missing executable or `cwd`. */
  readonly error: string | null;
  readonly timedOut: boolean;
  readonly durationMs: number;
  /** The signal that cancelled the gate while it ran, when the process went on after it. */
  readonly cancelled?: NodeJS.Signals;
}

/**
 * Where the signals that cancel the gate come from, and their own action
 * (review 0.1.432 B1): `process`'s, or a test's emitter.
 */
export interface CancelSignals {
  on(signal: NodeJS.Signals, listener: () => void): unknown;
  off(signal: NodeJS.Signals, listener: () => void): unknown;
  /** Called once the command's group is killed and its listeners are gone. */
  raise(signal: NodeJS.Signals): void;
}

/** The process's own signals: raised again with no listener of the command left, each takes its usual action. */
const PROCESS_SIGNALS: CancelSignals = {
  on: (signal, listener) => process.on(signal, listener),
  off: (signal, listener) => process.off(signal, listener),
  raise: (signal) => process.kill(process.pid, signal),
};

const CANCELLING: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

/** How long the pipes may stay open after the command exits: a process outside its group can hold them. */
const CLOSE_GRACE_MS = 1_000;

/**
 * Runs `command` with no shell, in its own process group, its output
 * handed to `output` as it comes. At `timeoutMs` the whole group is
 * killed; when the command exits, what is left of its group is killed too.
 * With `timeoutMs` 0 it does not start, and reads timed out. Review 0.1.432
 * B1: this process owns the group while the command runs. On SIGINT or
 * SIGTERM from `signals` it kills the group, waits until no process of it
 * is left, at most the close grace, then raises the signal again, so the
 * process ends as it would have. Its listeners go when the command settles.
 */
export function runCommand(
  command: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly timeoutMs: number;
    readonly output: (text: string) => void;
    /** `process`'s when absent. */
    readonly signals?: CancelSignals;
  },
): Promise<Ended> {
  if (options.timeoutMs <= 0) {
    return Promise.resolve({
      code: null,
      signal: null,
      error: null,
      timedOut: true,
      durationMs: 0,
    });
  }
  const started = performance.now();
  const [file = "", ...args] = command;
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let timedOut = false;
    let error: string | null = null;
    let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    const killGroup = () => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // ESRCH: the group has ended.
      }
    };
    /** No process of the group is left, reaped or not: a zombie still counts. */
    const groupGone = () => {
      if (child.pid === undefined) return true;
      try {
        process.kill(-child.pid, 0);
        return false;
      } catch {
        return true;
      }
    };
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (text: string) => options.output(text));
    }
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, options.timeoutMs);
    const signals = options.signals ?? PROCESS_SIGNALS;
    let cancelled: NodeJS.Signals | null = null;
    /** Ends once the signal is raised again; the command settles after it. */
    let cancelling: Promise<void> | null = null;
    const cancel = (signal: NodeJS.Signals) => {
      if (cancelled !== null) return;
      cancelled = signal;
      unlisten();
      killGroup();
      // The signal's own action once no process of the group is left, or the close grace ends.
      const until = performance.now() + CLOSE_GRACE_MS;
      cancelling = new Promise((done) => {
        const poll = setInterval(() => {
          if (!groupGone() && performance.now() < until) return;
          clearInterval(poll);
          signals.raise(signal);
          done();
        }, 10);
      });
    };
    const listeners = CANCELLING.map((signal) => [signal, () => cancel(signal)] as const);
    const unlisten = () => {
      for (const [signal, listener] of listeners) signals.off(signal, listener);
    };
    for (const [signal, listener] of listeners) signals.on(signal, listener);
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unlisten();
      const durationMs = Math.round(performance.now() - started);
      const ended: Ended = {
        code: exit?.code ?? null,
        signal: exit?.signal ?? null,
        error,
        timedOut,
        durationMs,
        ...(cancelled === null ? {} : { cancelled }),
      };
      if (cancelling === null) resolve(ended);
      else void cancelling.then(() => resolve(ended));
    };
    child.once("error", (e) => {
      error = e.message;
      if (child.pid === undefined) settle();
    });
    child.once("exit", (code, signal) => {
      exit = { code, signal };
      killGroup();
      setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        settle();
      }, CLOSE_GRACE_MS).unref();
    });
    // `close`, not `exit`: the output is whole once every pipe closed.
    child.once("close", settle);
  });
}
