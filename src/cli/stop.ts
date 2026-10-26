import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { recordedDaemon } from "../core/daemon/ensure.js";
import { type DaemonMarks, type Leftover, leftovers, marksOf } from "../core/daemon/leftovers.js";
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
 * `squeal stop [root]`: asks the worktree's daemon to shut down and waits for
 * it and every process it started to go, the step before deleting a worktree.
 * Exits 0 once they are gone or no daemon ran, 1 past a bound, saying what is
 * left. Once no daemon serves, it leaves the stopped mark (task 011-08), so
 * no hook starts one before the next edit or `squeal start`. An explicit root is that worktree's only (task 011-09, #25): a path
 * that is missing or not a worktree's top level stops nothing and exits 1,
 * never the checkout around it.
 */
export async function stopCommand(
  args: readonly string[],
  io: CliIo,
  bounds: StopBounds = STOP_BOUNDS,
): Promise<number> {
  if (args.length > 1 || args[0]?.startsWith("-")) {
    io.stderr("usage: squeal stop [root]\n");
    return 2;
  }
  const root = args[0] === undefined ? worktreeRoot(undefined, io) : explicitRoot(args[0], io);
  if (root === null) return 1;
  const socketPath = await daemonSocket(root);
  const ping = await askDaemon(socketPath, { type: "ping" }).catch(() => null);
  const daemon = ping?.ok === true && ping.type === "ping" ? ping : null;
  // Read while it runs: its record's token is its children's mark, its group may be theirs.
  const marks = daemon === null ? null : marksOf(daemon.pid, tokenOf(root, daemon));
  const tree = await stopTree(root);
  const response = await askDaemon(socketPath, { type: "stop" });
  if (response === null) {
    stoppedMark(root, tree, io);
    io.stdout(`No daemon running for ${root}\n`);
    return 0;
  }
  if (!response.ok) {
    io.stderr(`squeal: the daemon refused to stop: ${response.error}\n`);
    return 1;
  }
  const deadline = Date.now() + bounds.socketMs;
  while ((await askDaemon(socketPath, { type: "ping" }).catch(() => "busy")) !== null) {
    if (Date.now() > deadline) {
      const which = daemon === null ? "" : ` (pid ${daemon.pid})`;
      io.stdout(
        `Stop requested; the daemon for ${root}${which} still serves after ${seconds(bounds.socketMs)}\n`,
      );
      return 1;
    }
    await sleep(50);
  }
  // Row 011-20: a hook between the socket and the mark finds no mark and may spawn.
  pauseAt("stop-mark");
  stoppedMark(root, tree, io);
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
    const named = left.map(({ pid, args }) => `pid ${pid} ${args}`.trim()).join("; ");
    const what =
      left.length === 1
        ? "a process it started still runs"
        : `${left.length} processes it started still run`;
    io.stdout(
      `Stop requested; the daemon for ${root} stopped, but ${what} after ${seconds(bounds.leftoversMs)}: ${named}\n`,
    );
    return 1;
  }
  io.stdout(`Squeal daemon stopped for ${root}\n`);
  return 0;
}

/** `leaveStoppedMark`, saying on stderr when it could not be written. */
function stoppedMark(root: AbsolutePath, tree: string | null, io: CliIo): void {
  const error = leaveStoppedMark(root, (io.now ?? Date.now)(), tree);
  if (error !== null) {
    io.stderr(`squeal: could not record the stop, so a hook may start a daemon again: ${error}\n`);
  }
}

/**
 * The worktree whose top level `path` names (relative to the CLI's cwd), or
 * `null` after printing why there is none: a removed worker's path must not
 * resolve to the enclosing checkout and stop its daemon.
 */
function explicitRoot(path: string, io: CliIo): AbsolutePath | null {
  const named = resolve(io.cwd ?? process.cwd(), path);
  if (lstatOrNull(named) === null) {
    io.stderr(`squeal: ${named} does not exist; nothing stopped\n`);
    return null;
  }
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

/** Waits up to `ms` for the processes of `marks` to be gone; those still there. */
async function leftoversGone(marks: DaemonMarks, ms: number): Promise<Leftover[]> {
  const deadline = Date.now() + ms;
  for (;;) {
    const left = await leftovers(marks);
    if (left.length === 0 || Date.now() > deadline) return left;
    await sleep(100);
  }
}

function seconds(ms: number): string {
  return `${ms / 1_000} s`;
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
function marked(path: AbsolutePath, daemon: { readonly pid: number } | null): LockCheck | null {
  const start = daemonStart(path, Date.now() as EpochMs);
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

/** No process `pid` exists here: signal 0 finds none. */
function processGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}
