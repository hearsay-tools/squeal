import { fileURLToPath } from "node:url";
import { squealVersion } from "../core/daemon/version.js";
import { formatStatus } from "../core/status/format-status.js";
import { formatWhy } from "../core/status/format-why.js";
import { CLI_READ_RETRY_MS } from "../core/status/open.js";
import { readStatus } from "../core/status/snapshot.js";
import { readWhy } from "../core/status/why.js";
import type { EpochMs } from "../core/types/common.js";
import { ciCommand } from "./ci.js";
import { codeCommand } from "./code.js";
import { codexRuntimeCommand } from "./codex/runtime.js";
import { codexStatusLine } from "./codex/status.js";
import { daemonCommand } from "./daemon.js";
import { exportCommand } from "./export.js";
import { failuresCommand } from "./failures.js";
import { holdCommand } from "./hold.js";
import { importCommand } from "./import.js";
import { init } from "./init.js";
import { lintCommand } from "./lint.js";
import { baseOf } from "./named-selection.js";
import { opencodeStatusLine } from "./opencode/status.js";
import { piStatusLine } from "./pi/status.js";
import { psCommand } from "./ps.js";
import { reachCommand } from "./reach.js";
import { removeCommand } from "./remove.js";
import { retryCommand } from "./retry.js";
import { runCommand } from "./run.js";
import { runnerHostCommand } from "./runner-host.js";
import { SETUP_USAGE, setupCommand } from "./setup/command.js";
import { startCommand } from "./start.js";
import { statusCommand } from "./status-command.js";
import { namedSnapshotCommand } from "./status-paths.js";
import { statusWaitCommand, waitConsumer } from "./status-wait.js";
import { CHECK_NEEDS_TEST_FILE, takeChecks } from "./status-wait-focus.js";
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
  squeal status <path>... [--check <text>]... [--full] [--json]
                                The verdict of the test files the paths select (a test
                                file, or a file in test files' closures) now, if the
                                daemon stores its pass over your edits within 750 ms:
                                exit 0, 1 on known failures, 3 without one; a path
                                that selects nothing is named beside it, exit 3 unless
                                a selected file fails; --full prints this worktree's
                                status first; --json: the files and their verdicts in
                                selection.testFiles; --check shows the focused outcome
                                of the named test files' checks whose name holds the
                                text, and asks for nothing
  squeal status --wait <ms> [--full] [--json]
                                Wait up to <ms> until nothing is pending at the current
                                revision or a check changed, then print status (--full:
                                in full) and last the line saying why it returned
  squeal status --wait <ms> <path>... [--check <text>]... [--full] [--json]
                                Wait up to <ms> for the test files the paths select,
                                then give their verdict as status <path>... does,
                                --json in selection.testFiles too; --check runs first,
                                alone, the checks of each test file named by its own
                                path whose name holds the text, and returns with their
                                outcome, not the file's verdict: exit 1 when one
                                failed, else 3 (--json: selection.focused)
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
  squeal code [<path>...] [--changed | --told] [--json]
                                With complexity.enabled: every function over the
                                complexity threshold, newest first, with its location,
                                complexity, decision points by kind and the revision it
                                went over; paths list every function in those files or
                                directories; --changed keeps those whose state changed
                                since this session registered, --told those over that
                                this session was told about and the files it changed
                                that are not judged; files not counted follow, with why
  squeal code --base <ref> [<path>...] [--test <file>...] [--group <name>...]
              [--timeout <seconds>] [--parts <dir>...] [--exceptions <file>] [--json]
                                Runs tests, with no daemon, for up to --timeout
                                seconds (default 600) in all: judges every JS/TS
                                function changed since git merge-base <ref> HEAD, test
                                callbacks included, against the CC and CRAP limits in
                                squeal.config.json at that commit; the test files that
                                load a changed file, the changed test files and the
                                --test files run with coverage, except a file whose
                                results and coverage for these bytes are in the parts
                                squeal ci record wrote to a --parts <dir>, or in the
                                repository's stores, both only read; of the first two,
                                only the files of a check group in scope run: every
                                test group not at manual, or gate.groups, at that
                                commit, and each --group <name>; paths keep the
                                functions in those files or directories. Prints the
                                verdict and each function not pass with its gap or
                                measure; --exceptions <file>: a
                                squeal-code-exceptions/1 file of verified entries; a
                                violation an entry covers reads accepted and does not
                                block; --json: the squeal-code-gate/1 report; exit 0
                                pass, 1 violations, 3 incomplete, 2 on a usage or
                                setup error
  squeal reach [<path>...] [--limit <n>] [--json]
                                What one edit of each file re-runs, from the stores,
                                with no daemon and no test run: files and test files
                                ranked by the seconds their tests load but do not
                                call, then by seconds re-run; each file's share of
                                the suite, edits in the window, coverage split, path
                                kinds, gateway and one suggestion; paths give those
                                files in full; --limit lists more than 10 per part;
                                without history it proposes squeal warmup
  squeal lint [<path>...] [--changed] [--json]
                                With lint.enabled: every file with ESLint findings,
                                newest first, each finding with its line, severity,
                                rule and message; paths show those files' findings,
                                or why they have none; --changed lists the files
                                whose lint state changed since this session registered
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
  squeal start [root]           Start this worktree's daemon if none runs, end every
                                hold command of it, print status
  squeal run --all [--force] [--wait]
                                Request a full-suite checkpoint from the daemon; both
                                lanes, fast files first
  squeal run --fast [--force] [--wait]
                                A checkpoint of the fast lane only, which is not a
                                full-suite checkpoint
  squeal run --slow [--wait <ms>]
                                Run the slow lane once no fast work is pending; with
                                --wait, wait up to <ms> in all: for the daemon to take
                                the request, then as status --wait does; exit 3 when
                                they end with the request or a slow file pending.
                                --fast --slow is --all
  squeal run <group> [--wait [<ms>]]
                                Run one group of checks in squeal.config.json now,
                                whatever its moment; with --wait, wait for its
                                results: exit 0 all current and passing, 1 with a
                                known failure, 3 without a verdict
  squeal run <group> <path>... [--wait [<ms>]]
                                Run now only the group's test files the paths
                                select, whatever its moment: a test file selects
                                itself; another path its namesakes or, with none,
                                its direct importers, then the runner.tierSize
                                shortest of its other direct importers; with
                                --wait, wait for those files only, exit codes as
                                above; a lint group takes no paths
  squeal retry <test file>... [--reason load|environment]
                                Re-run each file's failure once, caused outside the
                                code: load waits until the one-minute load average is
                                below the CPU count, environment is queued at once; the
                                run waits its turn, which status names; once per file,
                                inputs and session; the FAIL stays counted until a
                                retry passes. A file with no result at its inputs
                                (stale, never run, timed out) is queued once at once,
                                any reason or none
  squeal retry --cancel <test file>...
                                Withdraw a pending retry
  squeal export [--out <file>]  Write this worktree's passing results at its current
                                inputs to one gzipped file (default
                                squeal-results-<commit8>.json.gz), with what another
                                store needs to compute the same inputs; a test file with
                                a failure there is left out; needs no daemon
  squeal import <file> [--dry-run]
                                Add an export's results to this repository's store; a
                                result counts only where this worktree's inputs equal
                                the export's; prints the results added and each
                                difference of the export's environment from this
                                worktree's; --dry-run writes nothing
  squeal ci record [--out <dir>] -- <command> [args...]
                                In CI: run the project's Vitest command unchanged and
                                exit with its code; also write one part per Vitest
                                process into --out (default squeal-parts/): each test
                                file's outcome, checks, duration and observed reads,
                                and each project's environment; other runners only run.
                                It adds Squeal's coverage provider to the run, and the
                                part holds each test file's coverage record; it adds
                                none when the run has coverage of its own
                                (coverage.enabled, --coverage) or Node lacks
                                process.getBuiltinModule. No record for a file run with
                                a test name filter, with isolate: false or beside
                                node:inspector. The exit code stays the command's.
                                Requires that no other program changes the tests' input
                                files while the command runs: Squeal sees the reads and
                                writes of the command's Node processes, not every change
                                another program makes, so such a change can be exported
                                at content the test did not see
  squeal ci export --parts <dir>... [--out <file>]
                                In CI, after the shards: write the parts as one export
                                (default squeal-results-<commit8>.json.gz), keyed as a
                                daemon in this checkout of their commit keys
  squeal ci publish <export> [--keep <n>]
                                In CI, in the export job: push the export as
                                <shared.ref>/<commit> (default refs/squeal) to origin
                                and delete refs beyond the newest n main commits
                                (default 100)
  squeal ps [--repo] [--full] [--json] [--locks]
                                Every Squeal daemon of this user on this host, with its
                                test processes, their CPU and memory over 2 s, the host's
                                totals, and what should not be up, each with the command
                                that would end it; --repo: this repository only; --full
                                adds each test's child processes; exit 0, 1 with a flag,
                                3 on a platform other than Linux and macOS. --locks
                                (Linux): who holds or waits for each store's write lock
  squeal stop [--until-start] [root]
                                Stop this worktree's daemon; a hook starts one at the
                                next edit. --until-start: no edit or Git operation
                                starts one until squeal start
  squeal hold [--max <duration>] -- <command> [args...]
                                Run the command with this worktree's validation on hold:
                                the daemon cancels the runs it can, starts none, and
                                records and queues each edit; the queued work runs when
                                the command exits, after --max (default 3h), or when
                                start ends the hold; exits with the command's code
  squeal remove [--config]      Take Squeal out of this repository: stop every worktree's
                                daemon, delete the store and temp directories; --config
                                also deletes squeal.config.json
  squeal update                 Update the plugin in every harness that has it, to one
                                version, the fixed Codex plugin's runtime, and the
                                launcher install.sh put on the PATH
  squeal codex-runtime ensure --plugin-root <absolute> [--data <absolute>]
                                Fixed Codex plugin: select a complete local runtime
                                for new sessions, the current one or the plugin's
                                seed, with no network; exit 0 only when ready
  squeal codex-runtime update --plugin-root <absolute> [--data <absolute>]
                              [--tag squeal--v<version>] [--background]
                                Download, validate and select a newer runtime for new
                                sessions within 120 s, never an older one; running
                                sessions keep theirs; exit 1 when it failed, and the
                                selected runtime stays; --background prints nothing
                                and keeps the retry delays
  squeal codex-runtime status --plugin-root <absolute> [--data <absolute>] [--json]
                                Adapter and runtime versions, pinned sessions and the
                                last update check; exit 0 when ready, 1 when not
  squeal daemon <root> [--await-lock <ms>]
                                Run the daemon in the foreground (hooks start it); a
                                step-down's successor waits up to <ms> for the lock
  squeal runner-host <root> --runner vitest
                                Host the project's runner for a daemon over stdin and
                                stdout (the daemon starts it)
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
  /**
   * The command that starts this CLI again in a process of its own: Node,
   * its flags and the script. Given only by the process entry, whose
   * `stdout` and `stderr` are the process's own (spec 020 D14.4, #182).
   */
  readonly relaunch?: readonly string[];
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
  code: codeCommand,
  reach: reachCommand,
  lint: lintCommand,
  init,
  setup: setupCommand,
  warmup: warmupCommand,
  daemon: daemonCommand,
  start: startCommand,
  run: runCommand,
  retry: retryCommand,
  export: exportCommand,
  import: importCommand,
  ci: ciCommand,
  ps: psCommand,
  stop: stopCommand,
  hold: holdCommand,
  remove: removeCommand,
  update: updateCommand,
  "codex-runtime": codexRuntimeCommand,
  "runner-host": runnerHostCommand,
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
  // Issue 11: `--help` anywhere after the command is its help, before its parser runs; what
  // follows `--` is `squeal hold`'s command, whose own flags they are (row 011-74).
  const end = rest.indexOf("--");
  const own = end === -1 ? rest : rest.slice(0, end);
  if (own.includes("--help") || own.includes("-h")) {
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
  // Row 011-146 (011 C15 as amended 2026-10-23): `--check <text>`, repeatable.
  const taken = takeChecks(wait.rest);
  if (typeof taken === "string") return usage("status", taken, io);
  const { checks } = taken;
  const allNotes = taken.rest.includes("--notes");
  const full = allNotes || taken.rest.includes("--full");
  const rest = taken.rest.filter((arg) => arg !== "--notes" && arg !== "--full");
  const parsed = parseArgs("status", rest, io);
  if (parsed === null) return 2;
  if (checks.length > 0 && parsed.positional.length === 0) {
    return usage("status", CHECK_NEEDS_TEST_FILE, io);
  }
  const named = { full, allNotes, ...(checks.length === 0 ? {} : { checks }) };
  const now = io.now ?? Date.now;
  if (waitMs !== null) {
    return statusWaitCommand(waitMs, parsed.json, io, false, parsed.positional, named);
  }
  if (parsed.positional.length > 0) {
    return namedSnapshotCommand(parsed.positional, { ...named, json: parsed.json }, io, { now });
  }
  const cwd = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;
  // Spec 015 D6: "since this session started" counts from the shell's session, as `--wait` reads it.
  const shell = waitConsumer(env);
  const result = readStatus(cwd, { now, busyRetryMs: CLI_READ_RETRY_MS, shell });
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
  const cwd = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;
  const result = readWhy(cwd, name, {
    includeLogs,
    busyRetryMs: CLI_READ_RETRY_MS,
    session: whySession(env),
  });
  // Row 011-67 (gh-52): a printed command names the CLI and its path as status does.
  const base = result.available && result.found ? baseOf(result.worktreeRoot, cwd) : "";
  const now = (io.now ?? Date.now)();
  io.stdout(parsed.json ? json(result) : formatWhy(result, statusCommand(env), { base, now }));
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
