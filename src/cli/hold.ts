import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { pidNamespace } from "../core/delivery/harness-process.js";
import { findWorktreeRoot, resolveCommonDir, worktreeIdFor } from "../core/fs/index.js";
import {
  boundText,
  COMMAND_HOLD_MAX_MS,
  holderGone,
  holdName,
  processIdentity,
} from "../core/scheduler/command-hold.js";
import {
  addCommandHold,
  clearCommandHolds,
  removeCommandHold,
  setCommandHoldChild,
} from "../core/scheduler/hold-rows.js";
import { STATUS_BUSY_TIMEOUT_MS } from "../core/status/index.js";
import { isStoreOpenFailure, openStore } from "../core/store/index.js";
import type {
  AbsolutePath,
  DaemonRequest,
  DaemonResponse,
  Store,
  WorktreeId,
} from "../core/types/index.js";
import { askDaemon, daemonSocket } from "./daemon-access.js";
import { durationMs } from "./failures.js";
import type { CliIo } from "./main.js";

/*
 * Row 011-74 (spec 011 C9 as amended 2026-10-21, *Hold command*;
 * `tasks/011-61/design.md` R3): `squeal hold [--max <duration>] -- <command>
 * [args...]` holds the worktree's validation for the life of the command, so
 * a long manual gate does not share the host with Squeal's runs.
 */

/** How long the wrapper waits for the tiers the hold cancels before it starts the command. */
export const HOLD_WAIT_MS = 3_000;

const USAGE = "usage: squeal hold [--max <duration>] -- <command> [args...]\n";

/** The signals the wrapper passes on to its command. */
const FORWARDED = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

export interface HoldDeps {
  /** One request to the worktree's daemon; `null` when none listens. Default the socket's. */
  readonly ask?: (root: AbsolutePath, request: DaemonRequest) => Promise<DaemonResponse | null>;
  readonly holdWaitMs?: number;
}

/**
 * Adds the entry, asks the daemon to hold and waits at most `HOLD_WAIT_MS`
 * for the tiers it cancels, runs the command with the inherited stdio, and
 * removes the entry when it exits; the last removal asks the daemon to
 * resume. Exits with the command's code, `128 + n` for signal `n`, 127 or
 * 126 when it cannot start, 2 on a usage error. Without a store it runs the
 * command and says that nothing is on hold.
 */
export async function holdCommand(
  args: readonly string[],
  io: CliIo,
  deps: HoldDeps = {},
): Promise<number> {
  const parsed = parse(args);
  if (typeof parsed === "string") {
    io.stderr(`squeal hold: ${parsed}\n${USAGE}`);
    return 2;
  }
  const cwd = io.cwd ?? process.cwd();
  const ask =
    deps.ask ?? ((root, request) => daemonSocket(root).then((s) => askDaemon(s, request)));
  const now = io.now ?? Date.now;
  const root = findWorktreeRoot(cwd);
  const begun = root === null ? `${cwd} is not inside a git worktree` : begin(root, parsed, now());
  const held = typeof begun === "string" ? null : begun;
  if (held === null) io.stderr(`squeal: nothing is on hold: ${begun}\n`);
  else if (root !== null) {
    const told = await holdDaemon(root, ask, deps.holdWaitMs ?? HOLD_WAIT_MS);
    const until = new Date(held.until).toTimeString().slice(0, 8);
    io.stderr(
      `squeal: validation of ${root} is on hold until \`${held.command}\` exits, at most ` +
        `until ${until} (${boundText(held.until - held.since)}); edits are recorded and not run${told}\n`,
    );
  }
  const ended = await run(parsed.command, cwd, (child) => {
    if (root === null || held === null) return;
    const identity = child.pid === undefined ? null : processIdentity(child.pid);
    withStore(root, (store, id) => setCommandHoldChild(store, id, held.token, identity));
  });
  if (typeof ended !== "number") io.stderr(`squeal hold: ${ended.failed}\n`);
  if (root !== null && held !== null) {
    // Its heartbeat removes an entry left here, once the command is gone too.
    const left = withStore(root, (store, id) => removeCommandHold(store, id, held.token));
    // Gone already: `squeal start` or its bound ended it, and the daemon resumed then.
    if (typeof left !== "string" && left !== null) {
      await ask(root, { type: "resume" }).catch(() => null);
    }
  }
  return typeof ended === "number" ? ended : ended.code;
}

/**
 * `squeal start` (row 011-74, 011 C9): removes every command hold of the
 * worktree at `root`, as it clears a stopped mark. Returns a line for each
 * whose command still runs; the commands run on.
 */
export function endCommandHolds(root: AbsolutePath): string[] {
  const ended = withStore(root, (store, id) => clearCommandHolds(store, id));
  if (typeof ended === "string") return [];
  const namespace = pidNamespace();
  return ended
    .filter((entry) => !holderGone(entry, namespace))
    .map((entry) => `Ended the hold for ${holdName(entry)}; the command still runs\n`);
}

interface Parsed {
  readonly maxMs: number;
  readonly command: readonly [string, ...string[]];
}

/** The options before `--`, or before the first argument that is not one, then the command. */
function parse(args: readonly string[]): Parsed | string {
  let maxMs = COMMAND_HOLD_MAX_MS;
  let i = 0;
  for (; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--") {
      i += 1;
      break;
    }
    if (arg === "--max" || arg.startsWith("--max=")) {
      const text = arg === "--max" ? (args[++i] ?? "") : arg.slice("--max=".length);
      const ms = durationMs(text);
      if (ms === null || ms === 0) {
        return `--max takes a duration such as 90s, 30m, 2h or 1d, not "${text}"`;
      }
      maxMs = ms;
    } else if (arg.startsWith("-")) return `unexpected argument "${arg}"`;
    else break;
  }
  const [program, ...rest] = args.slice(i);
  if (program === undefined) return "expected a command to run";
  return { maxMs, command: [program, ...rest] };
}

interface Begun {
  readonly token: string;
  readonly since: number;
  readonly until: number;
  readonly command: string;
}

/** Adds the entry; without a store, which a hold never creates, why nothing is on hold. */
function begin(root: AbsolutePath, parsed: Parsed, since: number): Begun | string {
  const held = {
    token: randomUUID(),
    since,
    until: since + parsed.maxMs,
    command: parsed.command.join(" "),
  };
  const wrapper = processIdentity(process.pid);
  const added = withStore(root, (store, id) =>
    addCommandHold(store, id, { ...held, wrapper, child: null }),
  );
  return typeof added === "string" ? added : held;
}

/**
 * Asks the daemon to hold, then for the tiers it cancelled, at most `waitMs`
 * in all. Returns what the start line adds: nothing, or why the daemon
 * cannot hold.
 */
async function holdDaemon(
  root: AbsolutePath,
  ask: NonNullable<HoldDeps["ask"]>,
  waitMs: number,
): Promise<string> {
  const deadline = performance.now() + waitMs;
  const answer = await ask(root, { type: "hold" }).catch((error: unknown) => String(error));
  // No daemon: the next one starts on hold.
  if (answer === null) return "";
  if (typeof answer === "string" || !answer.ok) {
    const why = typeof answer === "string" ? answer : answer.error;
    return `; the running daemon did not take the hold (${why}), so its tiers run on`;
  }
  if (answer.type !== "hold") return "";
  for (let state = answer; !state.settled && performance.now() < deadline; ) {
    await sleep(50);
    const next = await ask(root, { type: "hold-status", requestId: answer.requestId }).catch(
      () => null,
    );
    if (next === null || !next.ok || next.type !== "hold") break;
    state = next;
  }
  return "";
}

/** A command that could not start: why, and the shell's code for it. */
interface NotRun {
  readonly failed: string;
  readonly code: 126 | 127;
}

/**
 * Runs `command` with the inherited stdio and passes SIGINT, SIGTERM and
 * SIGHUP on to it; `spawned` hears of it once it runs. Resolves with its
 * exit code, `128 + n` for signal `n`, or why it could not start: 127 when
 * it is not found, 126 otherwise, as a shell exits.
 */
function run(
  command: Parsed["command"],
  cwd: string,
  spawned: (child: ChildProcess) => void,
): Promise<number | NotRun> {
  const [program, ...args] = command;
  return new Promise((resolve) => {
    let started = false;
    let settled = false;
    const child = spawn(program, args, { cwd, stdio: "inherit" });
    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    for (const signal of FORWARDED) process.on(signal, forward);
    const done = (result: number | NotRun) => {
      if (settled) return;
      settled = true;
      for (const signal of FORWARDED) process.off(signal, forward);
      resolve(result);
    };
    child.once("spawn", () => {
      started = true;
      spawned(child);
    });
    // After the spawn an error is a failed signal; the exit still decides.
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (started) return;
      const code = error.code === "ENOENT" ? 127 : 126;
      done({ failed: `could not run ${program}: ${error.message}`, code });
    });
    child.once("exit", (code, signal) =>
      done(code ?? 128 + (signal === null ? 0 : (constants.signals[signal] ?? 0))),
    );
  });
}

/**
 * `fn` over the worktree's store, closed after; without a store, or one that
 * cannot be opened or written, why not. A hold never creates a store.
 */
function withStore<T>(root: AbsolutePath, fn: (store: Store, id: WorktreeId) => T): T | string {
  const none = "no Squeal daemon has run in this worktree";
  try {
    const commonDir = resolveCommonDir(root);
    if (commonDir === null) return none;
    const store = openStore(commonDir, { create: false, busyTimeoutMs: STATUS_BUSY_TIMEOUT_MS });
    if (isStoreOpenFailure(store)) {
      return store.reason === "missing"
        ? none
        : `its Squeal store could not be opened (${store.reason})`;
    }
    try {
      return fn(store, worktreeIdFor(root));
    } finally {
      store.close();
    }
  } catch (error) {
    return `its Squeal store could not be written (${error instanceof Error ? error.message : String(error)})`;
  }
}
