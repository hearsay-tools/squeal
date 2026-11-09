import { spawn } from "node:child_process";
import type { AbsolutePath } from "../types/common.js";

/*
 * Spec 018 D13, D14: git for the shared results ref, with bytes in and out
 * (an export is gzip) and git's network set so it never waits for a person:
 * no terminal prompt, ssh in batch mode with a connect timeout, and a kill
 * timer of the caller's (`transport.md` Q3). The caller's stop starts no git
 * once given and kills the one running (R1 of row 018-20).
 */

/** Variables that would point git at another repository than `cwd`. */
const REPOSITORY_VARIABLES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
];

/** ssh's options for a fetch nobody watches: no password prompt, a bounded connect. */
const SSH_BATCH = "-o BatchMode=yes -o ConnectTimeout=3";

export interface GitCall {
  /** Written to stdin; empty when absent. */
  readonly input?: Buffer | string;
  /** Kills git after this long; the call then answers `timedOut`. */
  readonly timeoutMs: number;
  /** Set over the process environment. */
  readonly env?: Readonly<Record<string, string>>;
  /** The owner's stop: once aborted, no git starts, and one running is killed. */
  readonly signal?: AbortSignal;
}

export interface GitAnswer {
  /** `null` when git was killed or did not start. */
  readonly code: number | null;
  readonly stdout: Buffer;
  /** stderr, trimmed; the spawn error when git did not start. */
  readonly stderr: string;
  readonly timedOut: boolean;
}

/** What a call answers when its owner stopped. */
const STOPPED = "stopped";

/** Runs git in `cwd`; never rejects. Takes no optional locks. */
export function gitCall(
  cwd: AbsolutePath,
  args: readonly string[],
  call: GitCall,
): Promise<GitAnswer> {
  const { signal } = call;
  if (signal?.aborted) {
    return Promise.resolve({
      code: null,
      stdout: Buffer.alloc(0),
      stderr: STOPPED,
      timedOut: false,
    });
  }
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0", ...call.env };
  for (const name of REPOSITORY_VARIABLES) delete env[name];
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    let settled = false;
    const settle = (answer: GitAnswer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      resolve(answer);
    };
    // A child git started (ssh, a transport helper) can hold the pipes: release them and answer.
    const kill = (why: string) => {
      child.kill("SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
      settle({ code: null, stdout: Buffer.concat(stdout), stderr: why, timedOut });
    };
    const stop = () => kill(STOPPED);
    const timer = setTimeout(() => {
      timedOut = true;
      kill("");
    }, call.timeoutMs);
    signal?.addEventListener("abort", stop, { once: true });
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) =>
      settle({ code: null, stdout: Buffer.alloc(0), stderr: error.message, timedOut }),
    );
    child.on("close", (code) =>
      settle({
        code: timedOut ? null : code,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString("utf8").trim(),
        timedOut,
      }),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(call.input ?? "");
  });
}

/** stdout as text with its last newline removed, or `null` unless git exited 0. */
export function textOf(answer: GitAnswer): string | null {
  return answer.code === 0 ? answer.stdout.toString("utf8").replace(/\n$/, "") : null;
}

/** What a failed call says, in one line: git's first error line, or the timeout. */
export function failureOf(answer: GitAnswer, timeoutMs: number): string {
  if (answer.timedOut) {
    return `stopped after ${timeoutMs < 1000 ? `${timeoutMs} ms` : `${Math.round(timeoutMs / 1000)} s`}`;
  }
  const line = answer.stderr.split("\n").find((l) => l.trim() !== "") ?? "";
  return line === "" ? `git exited ${answer.code}` : line.replace(/^fatal: /, "");
}

/**
 * The environment of a call that may reach a remote: no terminal prompt,
 * and ssh in batch mode with a 3 s connect timeout. The user's own ssh
 * command (`GIT_SSH_COMMAND`, else `core.sshCommand`) is kept and the
 * options appended; `GIT_SSH` alone names a program that may take no
 * options, so it is left as it is and the kill timer bounds it.
 */
export async function networkEnv(
  cwd: AbsolutePath,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: "0" };
  const own = process.env.GIT_SSH_COMMAND;
  if (own !== undefined && own !== "") return { ...env, GIT_SSH_COMMAND: `${own} ${SSH_BATCH}` };
  if (process.env.GIT_SSH !== undefined && process.env.GIT_SSH !== "") return env;
  const configured = textOf(
    await gitCall(cwd, ["config", "--get", "core.sshCommand"], {
      timeoutMs: 5_000,
      ...(signal === undefined ? {} : { signal }),
    }),
  );
  const ssh = configured === null || configured === "" ? "ssh" : configured;
  return { ...env, GIT_SSH_COMMAND: `${ssh} ${SSH_BATCH}` };
}
