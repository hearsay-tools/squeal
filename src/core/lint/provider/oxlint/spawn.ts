import { spawn } from "node:child_process";

/*
 * Spec 017 D11 "Running": one oxlint run as a child process in its own
 * process group. On the guard, and after every exit, the whole group gets
 * SIGKILL: a kill of oxlint's pid alone leaves tsgolint, or a process a
 * plugin started, running (`research/oxlint-provider.md` Q3, Faults).
 */

export interface GroupRun {
  /** The exit code; `null` when a signal ended it or it never started. */
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  /** The guard ended it. */
  readonly timedOut: boolean;
  /** Why it never started, as `spawn` said; `null` when it ran. */
  readonly error: string | null;
}

export interface GroupOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly guardMs: number;
  /** Ends the group early, as the guard does: the provider's `close`. */
  readonly signal?: AbortSignal;
}

export function runInGroup(
  command: string,
  args: readonly string[],
  options: GroupOptions,
): Promise<GroupRun> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const pid = child.pid;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    let timedOut = false;
    let error: string | null = null;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(pid);
    }, options.guardMs);
    const abort = () => killGroup(pid);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted === true) abort();
    const settle = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      killGroup(pid);
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
        error,
      });
    };
    child.on("error", (e) => {
      error = e.message;
      if (pid === undefined) settle(null, null);
    });
    // `close`, not `exit`: the output is whole once every pipe closed.
    child.on("close", settle);
  });
}

function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // ESRCH: the group has ended.
  }
}
