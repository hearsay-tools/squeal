import { readFileSync } from "node:fs";
import { formatStatus, formatWhy, readStatus, readWhy } from "../core/status/index.js";
import type { EpochMs } from "../core/types/index.js";

const HELP = `squeal: continuous validation for coding agents. Push transitions, pull state.

Usage:
  squeal status [--json]        Current validation state of this worktree
  squeal why <check> [--json]   History and provenance of one check
  squeal --version              Print the version
  squeal --help                 Print this help

A check is named as in status output: "path > describe > test", or any
unique part of that name. Status reads the store directly; no daemon needed.

Commands from spec 001 still to come: run, daemon, start, init.
`;

/** Reads `version` from the package manifest two levels up from `src/cli` or `dist/cli`. */
function readVersion(): string {
  const manifest = new URL("../../package.json", import.meta.url);
  const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
  if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
    return String(parsed.version);
  }
  throw new Error(`squeal: no version in ${manifest.pathname}`);
}

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Directory the command runs in. Default `process.cwd()`. */
  readonly cwd?: string;
  /** Clock for heartbeat ages. Default `Date.now`. */
  readonly now?: () => EpochMs;
}

/** Runs the CLI and returns the exit code. */
export function main(argv: readonly string[], io: CliIo): number {
  const [first, ...rest] = argv;
  if (first === "--version" || first === "-v") {
    io.stdout(`${readVersion()}\n`);
    return 0;
  }
  if (first === undefined || first === "--help" || first === "-h" || first === "help") {
    io.stdout(HELP);
    return 0;
  }
  if (first === "status") return status(rest, io);
  if (first === "why") return why(rest, io);
  io.stderr(`squeal: unknown command "${first}"\n\n${HELP}`);
  return 2;
}

/**
 * Exit codes for both commands: 0 with an answer, 1 when the store cannot
 * answer (status unavailable, no matching check), 2 on a usage error. Known
 * failures do not change the exit code: status reports, policy decides.
 */
function status(args: readonly string[], io: CliIo): number {
  const parsed = parseArgs("status", args, io);
  if (parsed === null) return 2;
  if (parsed.positional.length > 0) return usage("status", "takes no arguments", io);
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
