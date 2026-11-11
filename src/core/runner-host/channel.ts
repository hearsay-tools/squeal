import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import type { AbsolutePath } from "../types/common.js";
import type { HostRunner } from "./protocol.js";

/*
 * Spec 021 D8 (row 021-11): a local runner host is a child of the daemon,
 * `node <cli> runner-host <root> --runner <name>`, with the daemon's Node,
 * its arguments, environment and working directory, never the root (spec 001 D10): the
 * host enters the root for each call (`runner-split.md` Q2). It stays in the
 * daemon's process group, carries no mark (`stopMarked` would stop it), and
 * exits when its input ends.
 */

/**
 * How the daemon starts a runner host: its own Node, the arguments Node
 * runs it with and the `squeal` CLI script, so a host runs as the daemon
 * does. A daemon from the sources needs its loader (`--import tsx`) in the
 * host too (review 0.1.434 B6); a bundle's is none.
 */
export interface RunnerHostLaunch {
  readonly execPath: string;
  /** Node's own arguments before the script: `process.execArgv`. */
  readonly execArgv: readonly string[];
  readonly cli: string;
}

/** The daemon's end of one host's stdio. */
export interface HostChannel {
  /** The host's process; `null` when the start failed. */
  readonly pid: number | null;
  /** Writes one protocol line to the host's input. */
  write(line: string): void;
  /** The host's output: protocol lines and nothing else of worth. */
  readonly output: Readable;
  /** Resolves once the host ended, with how: `code 1`, `signal SIGKILL`, or the start's error. */
  readonly ended: Promise<string>;
  /** Ends the host's input: it stops its runs and exits. */
  endInput(): void;
  /** Ends the host at once. */
  kill(): void;
  /** The end of what the host wrote to its stderr, for an error's text. */
  stderrTail(): string;
}

/** What `stderrTail` keeps. */
const TAIL = 2_000;
/** After the exit, how long the output may still deliver what the host wrote before it. */
const DRAIN_MS = 200;

/** Starts `squeal runner-host` for `runner` over `root`. */
export function spawnRunnerHost(
  launch: RunnerHostLaunch,
  root: AbsolutePath,
  runner: HostRunner,
  env: NodeJS.ProcessEnv = process.env,
): HostChannel {
  // Node 22 warns that node:sqlite is experimental; the warning would land in
  // the host's stderr tail and so in its exit note, as other launches silence it.
  const quiet = launch.execArgv.some((arg) => arg.startsWith("--disable-warning"))
    ? []
    : ["--disable-warning=ExperimentalWarning"];
  const args = [...quiet, ...launch.execArgv, launch.cli, "runner-host", root, "--runner", runner];
  return channelOf(spawn(launch.execPath, args, { env, stdio: ["pipe", "pipe", "pipe"] }));
}

/**
 * The daemon's end of a host process started with three pipes: a local host,
 * or the user's `ssh` running one on a remote (spec 021 D9, row 021-13).
 */
export function channelOf(child: ChildProcessWithoutNullStreams): HostChannel {
  let tail = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    tail = (tail + chunk).slice(-TAIL);
  });
  // A host gone before a write: its exit says so.
  child.stdin.on("error", () => {});
  child.stdout.setEncoding("utf8");
  const drained = new Promise<void>((resolve) => child.stdout.on("close", () => resolve()));
  const ended = new Promise<string>((resolve) => {
    child.on("error", (error) => resolve(`could not start: ${error.message}`));
    child.on("exit", (code, signal) => {
      const how = signal === null ? `code ${code}` : `signal ${signal}`;
      // A grandchild may hold the output open; what the host wrote is read within the bound.
      const bound = new Promise<void>((done) => setTimeout(done, DRAIN_MS).unref());
      void Promise.race([drained, bound]).then(() => resolve(how));
    });
  });
  return {
    pid: child.pid ?? null,
    write: (line) => {
      if (child.stdin.writable) child.stdin.write(line);
    },
    output: child.stdout,
    ended,
    endInput: () => child.stdin.end(),
    kill: () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    },
    stderrTail: () => tail.trim(),
  };
}
