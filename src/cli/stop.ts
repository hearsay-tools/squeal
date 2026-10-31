import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { recordedDaemon } from "../core/daemon/ensure.js";
import { marksOf } from "../core/daemon/leftovers.js";
import { acquireDaemonLock } from "../core/daemon/lock.js";
import { daemonStart } from "../core/daemon/start-mark.js";
import { pauseAt } from "../core/daemon/test-pause.js";
import {
  findWorktreeRoot,
  lstatOrNull,
  resolveCommonDir,
  worktreeIdFor,
} from "../core/fs/index.js";
import { lockFileFor } from "../core/store/index.js";
import type { AbsolutePath, EpochMs } from "../core/types/index.js";
import { askDaemon, daemonSocket, worktreeRoot } from "./daemon-access.js";
import type { CliIo } from "./main.js";
import { statusCommand } from "./status-command.js";
import { stopRemoved } from "./stop-removed.js";
import {
  leftoversClause,
  leftoversGone,
  processGone,
  seconds,
  socketClosed,
} from "./stop-waits.js";
import { leaveStoppedMark, stopTree } from "./stopped-mark.js";

/**
 * How long `squeal stop` waits (D10, tasks 001-340, 001-367): for the
 * daemon's socket to go, a stop cancelling its tiers within seconds; then for
 * its lock, which after the socket goes it releases within milliseconds that
 * an I/O stall on a loaded host stretched past 8 s (task 001-337), the wait a
 * daemon spawned meanwhile gives the lock (`VACANT_LOCK_WAIT_MS`); then for
 * the processes it started, which its exit stopped before the lock went.
 */
export interface StopBounds {
  readonly socketMs: number;
  readonly lockMs: number;
  readonly leftoversMs: number;
}

export const STOP_BOUNDS: StopBounds = { socketMs: 60_000, lockMs: 30_000, leftoversMs: 10_000 };

/**
 * `squeal stop [--until-start] [root]`: asks the worktree's daemon to shut
 * down and waits for it and every process it started to go, the step before
 * deleting a worktree. Exits 0 once they are gone or no daemon ran, 1 past a
 * bound, saying what is left. Once no daemon serves, it leaves the stopped
 * mark (task 011-08), so no hook starts one before the next edit or `squeal
 * start`; with `--until-start`, or over such a mark, before `squeal start`
 * alone (row 011-254, gh-104). An explicit root is that worktree's only (task
 * 011-09, #25): a path that is not a worktree's top level stops nothing and
 * exits 1, never the checkout around it; one that is gone stops the daemon
 * that served it, by the identity it had (row 011-277, `stopRemoved`), and
 * refuses `--until-start`: no worktree is there to hold.
 */
export async function stopCommand(
  args: readonly string[],
  io: CliIo,
  bounds: StopBounds = STOP_BOUNDS,
): Promise<number> {
  const parsed = stopArgs(args, io);
  if (typeof parsed === "number") return parsed;
  if ("removed" in parsed) return stopRemoved(parsed.removed, io, bounds);
  const { root, untilStart } = parsed;
  const socketPath = await daemonSocket(root);
  const ping = await askDaemon(socketPath, { type: "ping" }).catch(() => null);
  const daemon = ping?.ok === true && ping.type === "ping" ? ping : null;
  // Read while it runs: its record's token is its children's mark, its group may be theirs.
  const marks = daemon === null ? null : marksOf(daemon.pid, tokenOf(root, daemon));
  const tree = await stopTree(root);
  const response = await askDaemon(socketPath, { type: "stop" });
  if (response === null) {
    const until = stoppedMark(root, tree, untilStart, io);
    io.stdout(`No daemon running for ${root}; ${stoppedClause(until, io)}\n`);
    return 0;
  }
  if (!response.ok) {
    io.stderr(`squeal: the daemon refused to stop: ${response.error}\n`);
    return 1;
  }
  if (!(await socketClosed(socketPath, bounds.socketMs))) {
    const which = daemon === null ? "" : ` (pid ${daemon.pid})`;
    io.stdout(
      `Stop requested; the daemon for ${root}${which} still serves after ${seconds(bounds.socketMs)}\n`,
    );
    return 1;
  }
  // Row 011-20: a hook between the socket and the mark finds no mark and may spawn.
  pauseAt("stop-mark");
  const until = stoppedMark(root, tree, untilStart, io);
  const lock = await lockFreed(root, daemon, bounds.lockMs);
  const after = seconds(bounds.lockMs);
  if (lock.state === "held") {
    io.stdout(
      `Stop requested; the daemon for ${root} closed its socket but still holds its lock after ${after}\n`,
    );
    return 1;
  }
  if (lock.state === "unchecked") {
    io.stdout(
      `Stop requested; the daemon for ${root} closed its socket, and whether it still holds its lock could not be checked after ${after}: ${lock.error}\n`,
    );
    return 1;
  }
  const left = marks === null ? [] : await leftoversGone(marks, bounds.leftoversMs);
  if (left.length > 0) {
    const after = seconds(bounds.leftoversMs);
    io.stdout(
      `Stop requested; the daemon for ${root} stopped, but ${leftoversClause(left, after)}\n`,
    );
    return 1;
  }
  io.stdout(`Squeal daemon stopped for ${root}; ${stoppedClause(until, io)}\n`);
  return 0;
}

const UNTIL_START = "--until-start";

/**
 * The worktree `args` name and whether `--until-start` is among them, the
 * named path when it is gone (`stopRemoved`), or the exit code after saying
 * why neither.
 */
function stopArgs(
  args: readonly string[],
  io: CliIo,
):
  | { readonly root: AbsolutePath; readonly untilStart: boolean }
  | { readonly removed: AbsolutePath }
  | number {
  const rest = args.filter((arg) => arg !== UNTIL_START);
  if (rest.length > 1 || rest[0]?.startsWith("-")) {
    io.stderr(`usage: squeal stop [${UNTIL_START}] [root]\n`);
    return 2;
  }
  const untilStart = rest.length < args.length;
  const named = rest[0] === undefined ? null : resolve(io.cwd ?? process.cwd(), rest[0]);
  if (named !== null && lstatOrNull(named) === null) {
    if (!untilStart) return { removed: named };
    // Request 4c3a5f19 (the coordinator, 2026-10-31): a hold asked before its worktree exists is refused.
    io.stderr(
      `squeal: ${named} does not exist, so there is no worktree to hold; create it first, or drop ${UNTIL_START} to stop the daemon of a removed one; nothing stopped\n`,
    );
    return 1;
  }
  const root = named === null ? worktreeRoot(undefined, io) : explicitRoot(named, io);
  return root === null ? 1 : { root, untilStart };
}

/**
 * `leaveStoppedMark`, saying on stderr when it could not be written. Whether
 * the mark it left holds until `squeal start` alone (row 011-254).
 */
function stoppedMark(
  root: AbsolutePath,
  tree: string | null,
  untilStart: boolean,
  io: CliIo,
): boolean {
  const left = leaveStoppedMark(root, (io.now ?? Date.now)(), tree, untilStart);
  if (left.error !== null) {
    io.stderr(
      `squeal: could not record the stop, so a hook may start a daemon again: ${left.error}\n`,
    );
  }
  return left.untilStart;
}

/**
 * Row 011-254 (the coordinator, 2026-10-26): a success line's last clause,
 * the mode that holds until `squeal start`, or how to get it.
 */
function stoppedClause(untilStart: boolean, io: CliIo): string {
  const command = statusCommand(io.env ?? process.env);
  return untilStart
    ? `it stays stopped until \`${command} start\`: no edit or Git operation starts one`
    : `\`${command} stop ${UNTIL_START}\` keeps it stopped through edits and Git operations`;
}

/**
 * The worktree whose top level `named`, a path that is there, names, or
 * `null` after printing why there is none: a path inside a worktree must not
 * resolve to the enclosing checkout and stop its daemon.
 */
function explicitRoot(named: AbsolutePath, io: CliIo): AbsolutePath | null {
  const root = findWorktreeRoot(named);
  if (root === null) {
    io.stderr(`squeal: ${named} is not inside a git worktree\n`);
    return null;
  }
  if (root !== realpathSync(named)) {
    io.stderr(
      `squeal: ${named} is not a worktree root (it lies inside ${root}); nothing stopped\n`,
    );
    return null;
  }
  return root;
}

/** The token the store records for the daemon of `ping`, `null` for another start or none. */
function tokenOf(root: AbsolutePath, ping: { readonly startedAt: number }): string | null {
  const record = recordedDaemon(root);
  return record?.startedAt === ping.startedAt ? (record.token ?? null) : null;
}

/** How the stopping daemon's lock looked when `lockFreed` answered. */
export type LockCheck =
  | { readonly state: "free" | "held" }
  | { readonly state: "unchecked"; readonly error: string };

/**
 * Whether the stopping daemon let go of the worktree's lock within `ms`
 * (D10): its shutdown closes the socket before it releases the lock, so a
 * daemon whose socket is gone may still hold it. Free when the lock is (taken
 * and released at once, as status probes it, `daemonGone`), when the
 * daemon's process is gone, or when the store records a daemon of another
 * start time, which registers only once it holds the lock: a daemon spawned
 * meanwhile may take the lock the moment it comes free, and its pid may name
 * another process by then. Also free when no common dir or lock file is left
 * to hold, which only a lookup that finds the path missing proves: `existsSync`
 * is false under a directory it cannot search too (review 001-347, B1). A
 * probe or lookup that throws proves nothing (review 001-344, B1): the process
 * and the record still may, and at the bound the lock is `unchecked`. Row
 * 011-251: the marks beside the lock are read before it is probed (`marked`).
 */
export async function lockFreed(
  root: AbsolutePath,
  daemon: { readonly pid: number; readonly startedAt: number } | null,
  ms: number,
): Promise<LockCheck> {
  const commonDir = resolveCommonDir(root);
  if (commonDir === null) return { state: "free" };
  const path = lockFileFor(commonDir, worktreeIdFor(root));
  const deadline = Date.now() + ms;
  for (;;) {
    if (missing(path) || (daemon !== null && gone(root, daemon))) return { state: "free" };
    const probe = marked(path, daemon) ?? probeLock(path);
    if (probe.state === "free" || Date.now() > deadline) return probe;
    await sleep(50);
  }
}

/**
 * Row 011-251 (F4, gh-1): the lock as the marks beside it say, before any
 * probe (`daemonStart`): free while another process marks its start, since
 * it holds the lock; held, not probed, while a hook's spawn is marked, which
 * a probe could make exit as a loser (C9); `null` with neither.
 */
function marked(
  path: AbsolutePath,
  daemon: { readonly pid: number; readonly startedAt: number } | null,
): LockCheck | null {
  // A spawn before the stopping daemon started is not one to wait for.
  const started = daemon === null ? null : (daemon.startedAt as EpochMs);
  const start = daemonStart(path, Date.now() as EpochMs, started);
  if (start === null) return null;
  return start.kind === "spawned" || start.pid === daemon?.pid
    ? { state: "held" }
    : { state: "free" };
}

/** The daemon's process is gone, or a daemon of another start time registered since. */
function gone(root: AbsolutePath, daemon: { readonly pid: number; readonly startedAt: number }) {
  if (processGone(daemon.pid)) return true;
  const record = recordedDaemon(root);
  return record !== null && record.startedAt !== daemon.startedAt;
}

/** A lookup of `path` says it does not exist; one that fails otherwise proves nothing. */
function missing(path: AbsolutePath): boolean {
  try {
    return lstatOrNull(path) === null;
  } catch {
    return false;
  }
}

/** The lock at `path`, taken and released at once. */
function probeLock(path: AbsolutePath): LockCheck {
  try {
    const lock = acquireDaemonLock(path);
    lock?.release();
    return { state: lock === null ? "held" : "free" };
  } catch (error) {
    return { state: "unchecked", error: error instanceof Error ? error.message : String(error) };
  }
}
