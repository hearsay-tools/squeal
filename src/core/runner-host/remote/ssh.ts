import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import type { Readable } from "node:stream";

/*
 * Spec 021 D9, D14 (row 021-13): Squeal reaches a remote only through the
 * user's own `ssh` and its configuration. It reads and forwards no
 * credential, edits no file of the user's, and answers no prompt: a daemon
 * has no terminal, so `BatchMode` makes a key that needs a passphrase or an
 * unknown host key fail with ssh's own text instead of hanging.
 *
 * Spec 026 D8.1 (row 026-11): the channels of one awake machine share one
 * connection, a ControlMaster at a socket of Squeal's under `/tmp`, so a
 * second lane or runner costs no handshake. The machine closes it when it
 * sleeps and at the daemon's exit, so no connection holds a machine awake.
 * Only the user's own `ssh` multiplexes: a test's fake `ssh` does not.
 */

/** How to reach one remote. */
export interface SshTarget {
  /** The SSH destination as the user names it: a `Host` of their config, or `user@host`. */
  readonly destination: string;
  /**
   * Spec 026 D6.1 (row 026-10): extra ssh flags placed before
   * `destination`, such as a port, `IdentityFile` or `ProxyCommand`.
   */
  readonly args?: readonly string[];
  /** The `ssh` program; default `ssh` on the daemon's `PATH`. */
  readonly ssh?: string;
  /** The env `ssh` runs with; default the daemon's. */
  readonly env?: NodeJS.ProcessEnv;
}

/** `word` as one word of a POSIX shell command line. */
export function shellQuote(word: string): string {
  return /^[A-Za-z0-9_./:=@%+,-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

/**
 * `ssh`'s arguments to run `command` on the target: no terminal, never a
 * prompt, then the target's own flags (D6.1), its destination and the command.
 */
export function sshArgs(
  target: Pick<SshTarget, "destination" | "args">,
  command: string,
): string[] {
  return ["-T", "-o", "BatchMode=yes", ...(target.args ?? []), target.destination, command];
}

/** An SSH destination ssh takes as one: no leading `-` (an option), no space or control character. */
export function validTarget(target: unknown): target is string {
  return typeof target === "string" && /^[^-\s][^\s]*$/.test(target) && !/\p{Cc}/u.test(target);
}

/** Starts `command` on the remote with three pipes: its stdin, stdout and stderr. */
export function spawnSsh(target: SshTarget, command: string): ChildProcessWithoutNullStreams {
  return spawn(target.ssh ?? "ssh", sshArgs(target, command), {
    env: target.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/** How a one-shot remote command ended. */
export interface SshResult {
  /** The exit code; `null` when `ssh` was killed or did not start. */
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Why it did not end by itself: the deadline passed, or `ssh` could not start. */
  readonly failure?: string;
}

/** What `stderr` keeps of a one-shot command. */
const KEEP = 4_000;

/**
 * Runs `command` on the remote, feeding it `input`, and resolves once it
 * ends or `deadlineMs` passed, when `ssh` is killed (spec 021 D13: every
 * remote step has a deadline). Never rejects. Row 026-20 (review 0.1.623
 * B1): once `signal` aborts, `ssh` is killed and the result resolves at
 * once, not when a process the command left holds its output.
 */
export function sshRun(
  target: SshTarget,
  command: string,
  options: {
    readonly input?: Buffer | Readable;
    readonly deadlineMs: number;
    readonly signal?: AbortSignal;
  },
): Promise<SshResult> {
  return new Promise((resolve) => {
    const { signal } = options;
    if (signal?.aborted === true) {
      resolve({ code: null, stdout: "", stderr: "", failure: "aborted before it started" });
      return;
    }
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnSsh(target, command);
    } catch (error) {
      resolve({ code: null, stdout: "", stderr: "", failure: `could not start ssh: ${error}` });
      return;
    }
    let stdout = "";
    let stderr = "";
    let failure: string | undefined;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-KEEP);
    });
    // The remote may end without reading all of its input.
    child.stdin.on("error", () => {});
    const timer = setTimeout(() => {
      failure = `no answer within ${options.deadlineMs} ms`;
      child.kill("SIGKILL");
    }, options.deadlineMs);
    child.on("error", (error) => {
      failure ??= `could not start ssh: ${error.message}`;
    });
    const ended = (code: number | null) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({
        code,
        stdout,
        stderr: stderr.trim(),
        ...(failure === undefined ? {} : { failure }),
      });
    };
    const onAbort = () => {
      failure ??= "aborted";
      child.kill("SIGKILL");
      ended(null);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("close", ended);
    const { input } = options;
    if (input === undefined) child.stdin.end();
    else if (Buffer.isBuffer(input)) child.stdin.end(input);
    else input.pipe(child.stdin);
  });
}

/** One line for a failed command's note: its failure, else ssh's or the remote's text. */
export function sshFailure(what: string, result: SshResult): string {
  const why =
    result.failure ??
    (result.stderr === "" ? `exit code ${String(result.code)}` : result.stderr.split("\n").at(-1));
  return `${what}: ${why}`;
}

/**
 * Spec 026 D8.1: where the connection of the machine `machineId` for the
 * worktree at `root` is shared, short enough for a Unix socket's path;
 * `null` where `target` does not multiplex: another `ssh` program than
 * the user's, or Windows.
 */
export function controlSocket(target: SshTarget, machineId: string, root: string): string | null {
  if (target.ssh !== undefined || process.platform === "win32") return null;
  const key = createHash("sha256").update(`${machineId}\0${root}`).digest("hex").slice(0, 16);
  return `/tmp/squeal-ssh-${key}`;
}

/**
 * `target` sharing one connection at `socket` (D8.1): the first `ssh`
 * becomes its master, and the master stays `persistSeconds` after the last
 * channel closed. The target's own flags come first, so its own choices win.
 */
export function multiplexed(target: SshTarget, socket: string, persistSeconds: number): SshTarget {
  return {
    ...target,
    args: [
      ...(target.args ?? []),
      "-o",
      "ControlMaster=auto",
      "-o",
      `ControlPath=${socket}`,
      "-o",
      `ControlPersist=${Math.max(1, Math.ceil(persistSeconds))}`,
    ],
  };
}

/**
 * Ends the shared connection at `socket` (`ssh -O exit`), when one is
 * there; resolves once it ended or `deadlineMs` passed. Never rejects.
 */
export function closeMaster(target: SshTarget, socket: string, deadlineMs = 10_000): Promise<void> {
  if (!existsSync(socket)) return Promise.resolve();
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(
        target.ssh ?? "ssh",
        [...(target.args ?? []), "-o", `ControlPath=${socket}`, "-O", "exit", target.destination],
        { env: target.env ?? process.env, stdio: "ignore" },
      );
    } catch {
      resolve();
      return;
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), deadlineMs);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    child.on("error", done);
    child.on("close", done);
  });
}
