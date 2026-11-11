import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { Readable } from "node:stream";

/*
 * Spec 021 D9, D14 (row 021-13): Squeal reaches a remote only through the
 * user's own `ssh` and its configuration. It reads and forwards no
 * credential, edits no file of the user's, and answers no prompt: a daemon
 * has no terminal, so `BatchMode` makes a key that needs a passphrase or an
 * unknown host key fail with ssh's own text instead of hanging.
 */

/** How to reach one remote. */
export interface SshTarget {
  /** The SSH destination as the user names it: a `Host` of their config, or `user@host`. */
  readonly destination: string;
  /** The `ssh` program; default `ssh` on the daemon's `PATH`. */
  readonly ssh?: string;
  /** The env `ssh` runs with; default the daemon's. */
  readonly env?: NodeJS.ProcessEnv;
}

/** `word` as one word of a POSIX shell command line. */
export function shellQuote(word: string): string {
  return /^[A-Za-z0-9_./:=@%+,-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

/** `ssh`'s arguments to run `command` on `destination`: no terminal, never a prompt. */
export function sshArgs(destination: string, command: string): string[] {
  return ["-T", "-o", "BatchMode=yes", destination, command];
}

/** Starts `command` on the remote with three pipes: its stdin, stdout and stderr. */
export function spawnSsh(target: SshTarget, command: string): ChildProcessWithoutNullStreams {
  return spawn(target.ssh ?? "ssh", sshArgs(target.destination, command), {
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
 * remote step has a deadline). Never rejects.
 */
export function sshRun(
  target: SshTarget,
  command: string,
  options: { readonly input?: Buffer | Readable; readonly deadlineMs: number },
): Promise<SshResult> {
  return new Promise((resolve) => {
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
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout,
        stderr: stderr.trim(),
        ...(failure === undefined ? {} : { failure }),
      });
    });
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
