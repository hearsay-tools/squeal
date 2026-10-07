import { squealVersion } from "../core/daemon/version.js";
import { formatStatus, formatWhy, readStatus, readWhy } from "../core/status/index.js";
import type { EpochMs } from "../core/types/index.js";
import { daemonCommand } from "./daemon.js";
import { init } from "./init.js";
import { removeCommand } from "./remove.js";
import { runCommand } from "./run.js";
import { startCommand } from "./start.js";
import { statusWaitCommand } from "./status-wait.js";
import { stopCommand } from "./stop.js";

const HELP = `squeal: continuous validation for coding agents. Push transitions, pull state.

Usage:
  squeal status [--json]        Current validation state of this worktree
  squeal status --wait <ms> [--json]
                                Wait up to <ms> until nothing is pending at the current
                                revision or a check changed, then print status
  squeal why <check> [--json]   History and provenance of one check
  squeal init                   Set up this repository: squeal.config.json and the
                                plugin entries in .claude/settings.json
  squeal start [root]           Start this worktree's daemon if none runs, print status
  squeal run --all [--force] [--wait]
                                Request a full-suite checkpoint from the daemon
  squeal stop [root]            Stop this worktree's daemon
  squeal remove [--config]      Take Squeal out of this repository: stop every worktree's
                                daemon, delete the store and temp directories; --config
                                also deletes squeal.config.json
  squeal daemon <root>          Run the daemon in the foreground (hooks start it)
  squeal --version              Print the version
  squeal --help                 Print this help

A check is named as in status output: "path > describe > test", or any
unique part of that name. Status reads the store directly; no daemon needed.
`;

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Directory the command runs in. Default `process.cwd()`. */
  readonly cwd?: string;
  /** Clock for heartbeat ages. Default `Date.now`. */
  readonly now?: () => EpochMs;
}

/**
 * Commands that answer from the store at once; the daemon commands and
 * `status --wait` are asynchronous.
 */
type StoreCommand = "why";

/** Runs the CLI and returns the exit code. */
export function main(argv: readonly [StoreCommand, ...string[]], io: CliIo): number;
export function main(argv: readonly string[], io: CliIo): number | Promise<number>;
export function main(argv: readonly string[], io: CliIo): number | Promise<number> {
  const [first, ...rest] = argv;
  if (first === "--version" || first === "-v") {
    io.stdout(`${squealVersion()}\n`);
    return 0;
  }
  if (first === undefined || first === "--help" || first === "-h" || first === "help") {
    io.stdout(HELP);
    return 0;
  }
  if (first === "status") return status(rest, io);
  if (first === "why") return why(rest, io);
  if (first === "init") return init(rest, io);
  if (first === "daemon") return daemonCommand(rest, io);
  if (first === "start") return startCommand(rest, io);
  if (first === "run") return runCommand(rest, io);
  if (first === "stop") return stopCommand(rest, io);
  if (first === "remove") return removeCommand(rest, io);
  io.stderr(`squeal: unknown command "${first}"\n\n${HELP}`);
  return 2;
}

/**
 * Exit codes for both commands: 0 with an answer, 1 when the store cannot
 * answer (status unavailable, no matching check), 2 on a usage error. Known
 * failures do not change the exit code: status reports, policy decides.
 * `status --wait` also exits 0 when its wait timed out.
 */
function status(args: readonly string[], io: CliIo): number | Promise<number> {
  const waitAt = args.findIndex((a) => a === "--wait" || a.startsWith("--wait="));
  let waitMs: number | null = null;
  let rest = args;
  if (waitAt !== -1) {
    const arg = args[waitAt] as string;
    const inline = arg.startsWith("--wait=");
    const value = inline ? arg.slice("--wait=".length) : args[waitAt + 1];
    if (value === undefined || !/^\d+$/.test(value)) {
      return usage("status", "--wait takes a whole number of milliseconds", io);
    }
    waitMs = Number(value);
    rest = args.filter((_, i) => i !== waitAt && (inline || i !== waitAt + 1));
  }
  const parsed = parseArgs("status", rest, io);
  if (parsed === null) return 2;
  if (parsed.positional.length > 0) return usage("status", "takes no arguments", io);
  if (waitMs !== null) return statusWaitCommand(waitMs, parsed.json, io);
  const now = io.now ?? Date.now;
  const result = readStatus(io.cwd ?? process.cwd(), { now });
  io.stdout(parsed.json ? json(result) : formatStatus(result, now()));
  return result.available ? 0 : 1;
}

function why(args: readonly string[], io: CliIo): number {
  const parsed = parseArgs("why", args, io);
  if (parsed === null) return 2;
  const [name] = parsed.positional;
  if (name === undefined || parsed.positional.length > 1) {
    return usage("why", "expected one check name", io);
  }
  const result = readWhy(io.cwd ?? process.cwd(), name);
  io.stdout(parsed.json ? json(result) : formatWhy(result));
  return result.available && result.found ? 0 : 1;
}

function parseArgs(command: string, args: readonly string[], io: CliIo) {
  let isJson = false;
  const positional: string[] = [];
  for (const arg of args) {
    if (arg === "--json") isJson = true;
    else if (arg.startsWith("--")) {
      usage(command, `unknown option "${arg}"`, io);
      return null;
    } else positional.push(arg);
  }
  return { json: isJson, positional };
}

function usage(command: string, problem: string, io: CliIo): number {
  io.stderr(`squeal ${command}: ${problem}\n\n${HELP}`);
  return 2;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
