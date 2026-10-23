import { setTimeout as sleep } from "node:timers/promises";
import { ensureDaemon, probeDaemon, recordedDaemon } from "../core/daemon/ensure.js";
import { type DaemonMarks, leftovers, marksOf } from "../core/daemon/leftovers.js";
import { isNewerVersion, squealVersion } from "../core/daemon/version.js";
import {
  claimHandoff,
  handoffFrom,
  readHandoff,
  readShortHandoff,
  SUCCESSOR_LOCK_WAIT_MS,
} from "../core/delivery/handoff.js";
import { resolveCommonDir, worktreeIdFor } from "../core/fs/index.js";
import { formatStatus, readStatus, STATUS_BUSY_TIMEOUT_MS } from "../core/status/index.js";
import { isStoreOpenFailure, openStore } from "../core/store/index.js";
import type { AbsolutePath, DaemonRecord, EpochMs, PingResponse } from "../core/types/index.js";
import { keptCacheCli } from "../harness/shared/version-copies.js";
import { askDaemon, daemonSocket, worktreeRoot } from "./daemon-access.js";
import { endCommandHolds } from "./hold.js";
import type { CliIo } from "./main.js";
import { statusCommand } from "./status-command.js";
import { lockFreed, STOP_BOUNDS, type StopBounds } from "./stop.js";
import { clearStoppedMark } from "./stopped-mark.js";

/** A spawned daemon binds its socket in about 100 ms; a loaded machine gets more. */
const SPAWN_WAIT_MS = 10_000;

/**
 * `squeal start [root]`: clears the mark `squeal stop` left (task 011-08)
 * and ends every `squeal hold` (row 011-74; a running daemon is asked to
 * resume, a new one reads none), makes sure a daemon serves the worktree,
 * then prints its status: for one it spawned, once the store records it
 * (`served`, row 011-111). Exit code
 * 0 once a daemon answers, 1 otherwise. A stopping daemon is never said
 * alive: `start` finishes its handoff (`finishHandoff`, row 011-34), within
 * `bounds`, as long as `squeal stop` waits. Row 011-140: a daemon older
 * than this CLI that ended its handoff short, which no hook replaces, is
 * asked to step down first (`replaceShort`).
 */
export async function startCommand(
  args: readonly string[],
  io: CliIo,
  bounds: StopBounds = STOP_BOUNDS,
): Promise<number> {
  if (args.length > 1 || args[0]?.startsWith("-")) {
    io.stderr("usage: squeal start [root]\n");
    return 2;
  }
  const root = worktreeRoot(args[0], io);
  if (root === null) return 1;
  const cleared = clearStoppedMark(root);
  if (cleared !== null) io.stderr(`squeal: could not clear the stop mark: ${cleared}\n`);
  for (const line of endCommandHolds(root)) io.stdout(line);
  // This CLI's own script is the daemon to spawn (review wave 3, B1), or its kept copy when
  // it runs from Codex's plugin cache (row 005-77); `SQUEAL_CLI` overrides it.
  const script = process.argv[1];
  const cli =
    script === undefined ? undefined : keptCacheCli(script, squealVersion(), io.env ?? process.env);
  const now = io.now ?? Date.now;
  const stopping = (await stoppingDaemon(root, now)) ?? (await replaceShort(root));
  if (stopping !== null) return finishHandoff(root, cli, stopping, io, bounds);
  const result = await ensureDaemon(root, cli === undefined ? {} : { cli });
  if (result === "unavailable") {
    io.stderr(`squeal: no daemon could be reached or started for ${root}\n`);
    return 1;
  }
  if (result === "alive") {
    await askDaemon(await daemonSocket(root), { type: "resume" }).catch(() => null);
  }
  if (result === "spawned" && !(await served(root, Date.now() + SPAWN_WAIT_MS, () => true))) {
    io.stderr(`squeal: spawned a daemon for ${root}, but it did not answer\n`);
    return 1;
  }
  io.stdout(`Squeal daemon ${result} for ${root}\n\n`);
  io.stdout(formatStatus(readStatus(root, { now }), now(), statusCommand(io.env ?? process.env)));
  return 0;
}

/** The worktree's daemon while it stops: where it answers, its ping, its record and version. */
interface Stopping {
  readonly socketPath: AbsolutePath;
  /** `null` once its socket no longer answers. */
  readonly ping: PingResponse | null;
  /** `null` once it cleared it: only the handoff's claim is left. */
  readonly record: DaemonRecord | null;
  readonly from: string;
}

/**
 * The worktree's daemon when it is stopping (C9 as amended 2026-10-20): its
 * ping says `phase: "stopping"`, or the store says its shutdown began while
 * it holds its lock (`withStopping`). `null` otherwise. The record is read
 * before the status, so with a status that says stopping it is the stopping
 * daemon's or none, never a successor's that registered after (row 011-110).
 */
async function stoppingDaemon(root: AbsolutePath, now: () => number): Promise<Stopping | null> {
  const socketPath = await daemonSocket(root);
  const answer = await askDaemon(socketPath, { type: "ping" }).catch(() => null);
  const ping = answer?.ok === true && answer.type === "ping" ? answer : null;
  const record = recordedDaemon(root, 1_000);
  const status = readStatus(root, { now });
  const stopping = status.available ? status.daemon.stopping : undefined;
  if (ping?.phase !== "stopping" && stopping === undefined) return null;
  const from = stopping?.from ?? ping?.squealVersion ?? "";
  return { socketPath, ping, record, from };
}

/**
 * Row 011-140 (C9): the recorded daemon registered older than the handoff
 * claim it ended (`DaemonShort`), and this CLI is newer than it: when that
 * daemon answers at its socket, asks it to step down, as a hook would but
 * with the CLI's socket timeout, and returns it stopping once it accepts, so
 * `start` finishes the handoff (whose `stop` follows). Review 0.1.277, B3:
 * stopping from its acceptance on, whether or not its ping or the store says
 * so yet; read again, it could still read serving, and `start` said it was
 * alive. `null` otherwise.
 */
async function replaceShort(root: AbsolutePath): Promise<Stopping | null> {
  const record = recordedDaemon(root, 1_000);
  if (record === null || !isNewerVersion(squealVersion(), record.squealVersion)) return null;
  if (shortOf(root) !== handoffFrom(record)) return null;
  const { socketPath } = record;
  const answer = await askDaemon(socketPath, { type: "ping" }).catch(() => null);
  const ping = answer?.ok === true && answer.type === "ping" ? answer : null;
  if (ping === null || ping.startedAt !== record.startedAt) return null;
  const request = { type: "step-down", version: squealVersion() } as const;
  const accepted = await askDaemon(socketPath, request).catch(() => null);
  if (accepted?.ok !== true || accepted.type !== "step-down" || !accepted.steppingDown) return null;
  return { socketPath, ping, record, from: record.squealVersion };
}

/** The incarnation the worktree's short handoff names (`readShortHandoff`), `null` with none. */
function shortOf(root: AbsolutePath): string | null {
  try {
    const commonDir = resolveCommonDir(root);
    if (commonDir === null) return null;
    const store = openStore(commonDir, { create: false, busyTimeoutMs: STATUS_BUSY_TIMEOUT_MS });
    if (isStoreOpenFailure(store)) return null;
    try {
      return readShortHandoff(store, worktreeIdFor(root))?.of ?? null;
    } finally {
      store.close();
    }
  } catch {
    return null;
  }
}

/**
 * Row 011-34 (C9 as amended 2026-10-20, design 011-30 section 4): asks the
 * stopping daemon to `stop`, which cancels what it runs (one already
 * cancelling does nothing more); joins a live handoff claim, or claims one
 * and spawns this CLI's daemon with the lock wait; then waits for a daemon of
 * at least this version to answer, at most as long as `squeal stop` waits.
 * With the lock free it spawns whatever the claim: the claim's successor may
 * still be starting, or may have died before it took the lock, and the lock
 * decides between the two (D10; review 0.1.259, the coordinator's decision
 * of 2026-10-22). That spawn has no lock wait (row 011-110), so the claim's
 * successor stays the only one that waits. Nor does `start` claim or spawn
 * with the lock wait once a daemon registered after the stopping one
 * (`claims`), which ended the handoff. It prints the status once the store
 * records that daemon, or at the bound once it answered (`served`, row
 * 011-111). Past that bound with none answering it says what holds the lock, as
 * `squeal stop` does, and exits 1. A daemon before 0.1.200 finishes its tier
 * first, which only this bound covers.
 */
async function finishHandoff(
  root: AbsolutePath,
  cli: string | undefined,
  stopping: Stopping,
  io: CliIo,
  bounds: StopBounds,
): Promise<number> {
  const now = io.now ?? Date.now;
  const began = performance.now();
  const { ping, record } = stopping;
  // Read while it runs: its record's token is its children's mark (as `squeal stop` reads them).
  const marks = ping === null ? null : marksOf(ping.pid, tokenOf(ping, record));
  if (ping !== null) await askDaemon(stopping.socketPath, { type: "stop" }).catch(() => null);
  const old = ping?.startedAt ?? record?.startedAt ?? null;
  if (claims(root, old, now)) {
    await ensureDaemon(root, {
      ...(cli === undefined ? {} : { cli }),
      awaitLockMs: SUCCESSOR_LOCK_WAIT_MS,
    });
  } else if ((await lockFreed(root, null, 0)).state === "free") {
    // Joined a live claim: no lock wait, so its daemon takes the free lock at once or exits as
    // a loser (D10), never a second successor waiting beside the claim's (row 011-110).
    await ensureDaemon(root, cli === undefined ? {} : { cli });
  }
  const own = squealVersion();
  const deadline = Date.now() + bounds.socketMs + bounds.lockMs;
  if (!(await served(root, deadline, (ping) => follows(ping, old, own)))) {
    return stillHeld(root, stopping, marks, io, bounds);
  }
  const { from } = stopping;
  const took = ((performance.now() - began) / 1_000).toFixed(1);
  io.stdout(
    `Squeal daemon started for ${root}, after the ${from} daemon handed over in ${took} s\n\n`,
  );
  io.stdout(formatStatus(readStatus(root, { now }), now(), statusCommand(io.env ?? process.env)));
  return 0;
}

/** A daemon that serves after the stopping one: another start, not stopping, at least `own`. */
function follows(ping: PingResponse, old: number | null, own: string): boolean {
  return (
    ping.startedAt !== old && ping.phase !== "stopping" && !isNewerVersion(own, ping.squealVersion)
  );
}

/**
 * Row 011-111 (C9): waits until a daemon whose ping `accepts` answers and
 * the store records it, then `true`; at `deadline`, whether one answered. A
 * daemon answers on its socket before it registers. Until then status reads
 * no daemon, or in a handoff its claim, so it says the daemon hands over;
 * from its registration on, status reads it serving.
 */
async function served(
  root: AbsolutePath,
  deadline: number,
  accepts: (ping: PingResponse) => boolean,
): Promise<boolean> {
  for (;;) {
    const probe = await probeDaemon(root, 100);
    const answered = probe.state === "alive" && accepts(probe.ping);
    if (answered && registered(root, probe.ping)) return true;
    if (Date.now() > deadline) return answered;
    await sleep(50);
  }
}

/** Whether the store records the daemon of `ping`: its start time, as `follows` reads it. */
function registered(root: AbsolutePath, ping: PingResponse): boolean {
  return recordedDaemon(root, STATUS_BUSY_TIMEOUT_MS)?.startedAt === ping.startedAt;
}

/**
 * Whether `start` spawns the successor: it wrote the claim (row 011-32), or
 * could not read or write one; not when a live claim for the stopping daemon,
 * started at `old`, is there, whose successor already waits. With the record
 * cleared, any live claim is the handoff's. Row 011-110: the record is read
 * again with the claim, in one write transaction, as a daemon registers: its
 * record and the claim's end in one. A record of another start than `old`'s
 * is a daemon that registered after the stopping one, the claim's successor
 * or another, which ended the handoff: `start` claims nothing and spawns
 * nothing that waits for the lock beside it.
 */
function claims(root: AbsolutePath, old: number | null, now: () => number): boolean {
  try {
    const commonDir = resolveCommonDir(root);
    if (commonDir === null) return true;
    const store = openStore(commonDir, { create: false, busyTimeoutMs: STATUS_BUSY_TIMEOUT_MS });
    if (isStoreOpenFailure(store)) return true;
    try {
      const id = worktreeIdFor(root);
      const at = now() as EpochMs;
      return store.transaction(() => {
        const record = store.worktrees.get(id)?.daemon ?? null;
        if (record === null) {
          const claim = readHandoff(store, id);
          return claim === null || at >= claim.boundAt;
        }
        if (record.startedAt !== old) return false;
        const from = handoffFrom(record);
        return claimHandoff(store, id, { from, to: squealVersion(), at }) !== null;
      });
    } finally {
      store.close();
    }
  } catch {
    return true;
  }
}

/**
 * Past the bound: what still holds the lock, in `squeal stop`'s words (the
 * daemon's process, the processes it started), and exit 1.
 */
async function stillHeld(
  root: AbsolutePath,
  stopping: Stopping,
  marks: DaemonMarks | null,
  io: CliIo,
  bounds: StopBounds,
): Promise<number> {
  const { ping, from } = stopping;
  const after = `${(bounds.socketMs + bounds.lockMs) / 1_000} s`;
  const daemon = `the ${from === "" ? "" : `${from} `}daemon for ${root}${ping === null ? "" : ` (pid ${ping.pid})`}`;
  const lock = await lockFreed(root, ping, 0);
  const holds =
    lock.state === "free"
      ? `${daemon} let go of its lock, but no daemon of Squeal ${squealVersion()} or later answered after ${after}`
      : `${daemon} is still stopping and holds its lock after ${after}, so no daemon follows it`;
  const left = marks === null ? [] : await leftovers(marks);
  const named = left.map(({ pid, args }) => `pid ${pid} ${args}`.trim()).join("; ");
  const children =
    left.length === 0
      ? ""
      : `; ${left.length === 1 ? "a process it started still runs" : `${left.length} processes it started still run`}: ${named}`;
  io.stderr(`squeal: ${holds}${children}\n`);
  return 1;
}

/** The token the store records for the daemon of `ping`, `null` for another start or none. */
function tokenOf(ping: PingResponse, record: DaemonRecord | null): string | null {
  return record?.startedAt === ping.startedAt ? (record.token ?? null) : null;
}
