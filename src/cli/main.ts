import { fileURLToPath } from "node:url";
import { squealVersion } from "../core/daemon/version.js";
import {
  CLI_READ_RETRY_MS,
  formatStatus,
  formatWhy,
  readStatus,
  readWhy,
} from "../core/status/index.js";
import type { EpochMs } from "../core/types/index.js";
import { codexStatusLine } from "./codex/status.js";
import { daemonCommand } from "./daemon.js";
import { failuresCommand } from "./failures.js";
import { init } from "./init.js";
import { opencodeStatusLine } from "./opencode/status.js";
import { piStatusLine } from "./pi/status.js";
import { psCommand } from "./ps.js";
import { removeCommand } from "./remove.js";
import { retryCommand } from "./retry.js";
import { runCommand } from "./run.js";
import { SETUP_USAGE, setupCommand } from "./setup/command.js";
import { startCommand } from "./start.js";
import { statusCommand } from "./status-command.js";
import { namedSnapshotCommand } from "./status-paths.js";
import { statusWaitCommand, waitConsumer } from "./status-wait.js";
import { baseOf } from "./status-wait-paths.js";
import { stopCommand } from "./stop.js";
import { updateCommand } from "./update.js";
import { takeWait } from "./wait-arg.js";
import { warmupCommand } from "./warmup.js";

const HELP = `squeal: continuous validation for coding agents. Push transitions, pull state.

Usage:
  squeal status [--full] [--notes] [--json]
                                Current validation state of this worktree: its verdict,
                                known failures and outstanding work, each with what
                                advances it; --full adds the worktree, daemon,
                                inheritance, each file without a result and the notes;
                                --notes is --full with every note in full
  squeal status <path>... [--full] [--json]
                                The verdict of the test files the paths select (a test
                                file, or a file in test files' closures) now, if the
                                daemon stores its pass over your edits within 750 ms:
                                exit 0, 1 on known failures, 3 without one; a path
                                that selects nothing is named beside it, exit 3 unless
                                a selected file fails; --full prints this worktree's
                                status first; --json: the files and their verdicts in
                                selection.testFiles
  squeal status --wait <ms> [--full] [--json]
                                Wait up to <ms> until nothing is pending at the current
                                revision or a check changed, then print status (--full:
                                in full) and last the line saying why it returned
  squeal status --wait <ms> <path>... [--full] [--json]
                                Wait up to <ms> for the test files the paths select,
                                then give their verdict as status <path>... does,
                                --json in selection.testFiles too
  squeal why <check> [--include-logs] [--json]
                                History and provenance of one check, and the run log
                                holding its console output; --include-logs also prints
                                that log's lines from the check's test file
  squeal failures [<test file or directory>...] [--check <text>]... [--error <text>]...
                  [--per-check] [--limit <n>|all] [--all-worktrees] [--since <duration>]
                  [--json]
                                Stored failing results of this worktree, or every
                                worktree's, newest first: check, worktree, revision,
                                commit, time, duration, fingerprint; paths select
                                the checks of those test files or below those
                                directories, --check those whose name holds the
                                text, --error the failures whose error holds it;
                                --per-check lists each check once, at its newest
                                failure; --limit lists more than 20, all lists
                                every one; --since 2h lists only the last two hours
  squeal init                   Set up this repository: squeal.config.json and the
                                plugin entries in .claude/settings.json
  squeal init --harness codex [--print-launcher-config | --trust [--yes]]
                                Write squeal.config.json and print the Codex plugin
                                install and trust steps; or print the hooks and their
                                trust as thread/start config for a launcher; --trust
                                then shows the hooks Codex has not trusted and, on
                                your yes (--yes: without asking), has Codex trust them
  squeal init [--block <file|none>] [--gate <id>=<reword|keep>]...
              [--slow <glob>]... [--input <test glob>=<input glob|none>]...
                                Set the harness up, then apply these setup choices
  squeal setup --plan [--json]  What setting this repository up would change: harnesses,
                                runners, instruction files and their Squeal block, gate
                                lines, slow groups and their inputs, the warm-up's size
  squeal setup --check [--json] The plan; exit 1 when anything in it is outdated
  squeal setup [--yes] [<choice flags>]
                                Ask one question per open choice of the plan (--yes:
                                take the defaults), apply them, warm up, show the diff
  squeal warmup                 Start the daemon and run every test file without a
                                current result; exit 0, 1 on known failures, 3 without
                                a verdict; suggestions it finds, applied by squeal setup
  squeal start [root]           Start this worktree's daemon if none runs, print status
  squeal run --all [--force] [--wait]
                                Request a full-suite checkpoint from the daemon; both
                                lanes, fast files first
  squeal run --fast [--force] [--wait]
                                A checkpoint of the fast lane only, which is not a
                                full-suite checkpoint
  squeal run --slow [--wait <ms>]
                                Run the slow lane once no fast work is pending; with
                                --wait, then wait as status --wait does. --fast --slow
                                is --all
  squeal retry <test file>... [--reason load|environment]
                                Re-run each file's failure once, caused outside the
                                code: load waits until the one-minute load average is
                                below the CPU count, environment runs at once; once per
                                file, inputs and session; the FAIL stays counted until
                                a retry passes. A file with no result at its inputs
                                (stale, never run, timed out) runs once at once, any
                                reason or none
  squeal retry --cancel <test file>...
                                Withdraw a pending retry
  squeal ps [--repo] [--full] [--json]
                                Every Squeal daemon of this user on this host, with its
                                test processes, their CPU and memory over 2 s, the host's
                                totals, and what should not be up, each with the command
                                that would end it; --repo: this repository only; --full
                                adds each test's child processes; exit 0, 1 with a flag,
                                3 on a platform other than Linux and macOS
  squeal stop [root]            Stop this worktree's daemon
  squeal remove [--config]      Take Squeal out of this repository: stop every worktree's
                                daemon, delete the store and temp directories; --config
                                also deletes squeal.config.json
  squeal update                 Update the plugin in every harness that has it, to one
                                version, and the launcher install.sh put on the PATH
  squeal daemon <root> [--await-lock <ms>]
                                Run the daemon in the foreground (hooks start it); a
                                step-down's successor waits up to <ms> for the lock
  squeal --version              Print the version
  squeal --help                 Print this help
  squeal <command> --help       Print that command's part of this help

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
  /** Environment, read for the harness shell's session (`statusCommand`, `waitConsumer`). Default `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Commands that answer from the store at once; the daemon commands and
 * `status --wait` are asynchronous.
 */
type StoreCommand = "why" | "failures";

type Command = (args: readonly string[], io: CliIo) => number | Promise<number>;

/** Every command `main` dispatches, by name. */
const COMMANDS: Readonly<Record<string, Command>> = {
  status,
  why,
  failures: failuresCommand,
  init,
  setup: setupCommand,
  warmup: warmupCommand,
  daemon: daemonCommand,
  start: startCommand,
  run: runCommand,
  retry: retryCommand,
  ps: psCommand,
  stop: stopCommand,
  remove: removeCommand,
  update: updateCommand,
};

/** Usage beyond the command's lines in `HELP`: the setup choices `HELP` only names. */
const MORE_USAGE: Readonly<Record<string, string>> = { setup: SETUP_USAGE };

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
  const command = Object.hasOwn(COMMANDS, first) ? COMMANDS[first] : undefined;
  if (command === undefined) {
    io.stderr(`squeal: unknown command "${first}"\n\n${HELP}`);
    return 2;
  }
  // Issue 11: `--help` anywhere after the command is its help, before its parser runs.
  if (rest.includes("--help") || rest.includes("-h")) {
    io.stdout(commandHelp(first));
    return 0;
  }
  return command(rest, io);
}

/** The command's entries of `HELP`, each usage line with its description lines. */
function commandHelp(command: string): string {
  const lines: string[] = [];
  let inEntry = false;
  for (const line of HELP.split("\n")) {
    if (line.startsWith("  squeal ")) inEntry = new RegExp(`^  squeal ${command}\\b`).test(line);
    else if (!line.startsWith("   ")) inEntry = false;
    if (inEntry) lines.push(line);
  }
  const more = MORE_USAGE[command];
  return `Usage:\n${lines.join("\n")}\n${more === undefined ? "" : `\n${more}`}`;
}

/**
 * Exit codes for both commands: 0 with an answer, 1 when the store cannot
 * answer (status unavailable, no matching check), 2 on a usage error. Known
 * failures do not change the exit code: status reports, policy decides.
 * `status --wait` also exits 0 when its wait timed out. `status [--wait <ms>]
 * <path>...` exits as spec 005 D1 for the files the paths select (D2, as
 * amended 2026-10-20 for the form without `--wait`). `--full` prints the
 * worktree's status before a named answer, and `--notes` implies it (row
 * 011-28); on `squeal status` and the pathless wait it adds the detail
 * block to the default text (row 011-29).
 */
function status(args: readonly string[], io: CliIo): number | Promise<number> {
  const wait = takeWait(args);
  if (typeof wait === "string") return usage("status", wait, io);
  const { waitMs } = wait;
  const allNotes = wait.rest.includes("--notes");
  const full = allNotes || wait.rest.includes("--full");
  const rest = wait.rest.filter((arg) => arg !== "--notes" && arg !== "--full");
  const parsed = parseArgs("status", rest, io);
  if (parsed === null) return 2;
  const named = { full, allNotes };
  const now = io.now ?? Date.now;
  if (waitMs !== null) {
    return statusWaitCommand(waitMs, parsed.json, io, false, parsed.positional, named);
  }
  if (parsed.positional.length > 0) {
    return namedSnapshotCommand(parsed.positional, { ...named, json: parsed.json }, io, { now });
  }
  const cwd = io.cwd ?? process.cwd();
  const result = readStatus(cwd, { now, busyRetryMs: CLI_READ_RETRY_MS });
  const env = io.env ?? process.env;
  const harness = parsed.json
    ? null
    : (codexStatusLine(cwd, env) ??
      piStatusLine(cwd, env, fileURLToPath(import.meta.url)) ??
      opencodeStatusLine(cwd, env));
  const base = result.available ? baseOf(result.worktreeRoot, cwd) : "";
  const human = () =>
    `${formatStatus(result, now(), statusCommand(env), { full, allNotes, base })}${harness ?? ""}`;
  io.stdout(parsed.json ? json(result) : human());
  return result.available ? 0 : 1;
}

function why(args: readonly string[], io: CliIo): number {
  const includeLogs = args.includes("--include-logs");
  const parsed = parseArgs(
    "why",
    args.filter((arg) => arg !== "--include-logs"),
    io,
  );
  if (parsed === null) return 2;
  const [name] = parsed.positional;
  if (name === undefined || parsed.positional.length > 1) {
    return usage("why", "expected one check name", io);
  }
  const result = readWhy(io.cwd ?? process.cwd(), name, {
    includeLogs,
    busyRetryMs: CLI_READ_RETRY_MS,
    session: whySession(io.env ?? process.env),
  });
  io.stdout(parsed.json ? json(result) : formatWhy(result));
  return result.available && result.found ? 0 : 1;
}

/** The harness session `why` runs in (011-18): `waitConsumer`'s, or Pi's (`PI_SESSION_ID`), as `retry` reads it. */
function whySession(env: Readonly<Record<string, string | undefined>>) {
  const shell = waitConsumer(env);
  const pi = env.PI_SESSION_ID === "" ? undefined : env.PI_SESSION_ID;
  return shell.session !== null || pi === undefined ? shell : { session: pi, agent: null };
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
