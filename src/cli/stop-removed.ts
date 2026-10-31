import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { type DaemonMarks, marksOf } from "../core/daemon/leftovers.js";
import { socketPathFor } from "../core/daemon/paths.js";
import { statOf } from "../core/daemon/terminate.js";
import { daemonLiveness } from "../core/delivery/liveness.js";
import { findWorktreeRoot, lstatOrNull, resolveCommonDir } from "../core/fs/index.js";
import { createProcSource } from "../core/ps/proc.js";
import { isStoreOpenFailure, openStore } from "../core/store/index.js";
import { lockFileParts } from "../core/store/paths.js";
import type {
  AbsolutePath,
  DaemonRecord,
  EpochMs,
  PingResponse,
  Store,
  WorktreeId,
  WorktreeRecord,
} from "../core/types/index.js";
import { askDaemon } from "./daemon-access.js";
import type { CliIo } from "./main.js";
import type { StopBounds } from "./stop.js";
import {
  leftoversClause,
  leftoversGone,
  processGone,
  seconds,
  socketClosed,
} from "./stop-waits.js";

/** How long the stop waits for the store's lock to read a worktree's row. */
const STORE_BUSY_TIMEOUT_MS = 1_000;

/**
 * Row 011-277 (gh-126; 011 C1, C9, C14): `squeal stop <root>` once `named`
 * is gone, as a harness that removed a worker's directory first asks it. The
 * path keeps the identity it had: the worktree id of its former real path
 * (`formerRoot`), the row its store keeps, and the socket C1's rule picks
 * from that row's record (`servingDaemon`). Only a daemon that answers there
 * for that id and that root is asked to stop, so the checkout around the
 * path never is (task 011-09). It waits for the daemon's socket, its
 * process, then the processes it started, by its group and its record's
 * token, and says they stopped (exit 0), which still run past a bound (exit
 * 1), or that they cannot be told (exit 1). It leaves no stopped mark: no
 * hook runs in a root that is gone.
 */
export async function stopRemoved(
  named: AbsolutePath,
  io: CliIo,
  bounds: StopBounds,
): Promise<number> {
  const former = formerRoot(named);
  const { root } = former;
  const row = savedRow(former, io);
  const found = await servingDaemon(root, row?.daemon ?? null, io);
  if (found === null) return noDaemon(named, root, row, io);
  if (typeof found === "number") return found;
  const { socketPath, ping } = found;
  // Read while it runs: its start tells its pid from a reuse, its group and token mark its processes.
  const start = statOf(ping.pid)?.start ?? null;
  const marks = marksOf(ping.pid, savedToken(ping));
  const response = await askDaemon(socketPath, { type: "stop" });
  if (response !== null && !response.ok) {
    io.stderr(`squeal: the daemon refused to stop: ${response.error}\n`);
    return 1;
  }
  const which = `the daemon for ${root} (pid ${ping.pid})`;
  if (!(await socketClosed(socketPath, bounds.socketMs))) {
    io.stdout(`Stop requested; ${which} still serves after ${seconds(bounds.socketMs)}\n`);
    return 1;
  }
  if (!(await processEnded(ping.pid, start, bounds.lockMs))) {
    io.stdout(
      `Stop requested; ${which} closed its socket but still runs after ${seconds(bounds.lockMs)}\n`,
    );
    return 1;
  }
  const left = await leftoversGone(marks, bounds.leftoversMs);
  if (left.length > 0) {
    const after = seconds(bounds.leftoversMs);
    io.stdout(
      `Stop requested; the daemon for ${root} stopped, but ${leftoversClause(left, after)}\n`,
    );
    return 1;
  }
  const stopped = `Squeal daemon stopped for ${root}, which does not exist`;
  const untraced = untracedWhy(marks);
  if (untraced !== null) {
    io.stdout(`${stopped}; whether a process it started still runs is unknown: ${untraced}\n`);
    return 1;
  }
  io.stdout(`${stopped}, and no process it started still runs\n`);
  return 0;
}

/** A daemon that answers for the removed root, and the socket it answers at. */
interface Serving {
  readonly socketPath: AbsolutePath;
  readonly ping: PingResponse;
}

/**
 * The daemon that serves `root`, which is gone, by C1's rule over the record
 * its store keeps (`record`, review 0.1.383 B1): the recorded socket first
 * while its heartbeat is fresh, then the one this environment computes for
 * `root`'s id. A recorded socket whose heartbeat is late is pinged before no
 * daemon is claimed, and never asked to stop: `null` only when no daemon
 * answers at the computed socket nor at a recorded one. Else exit 1 after
 * saying why none is asked to stop: the answer is no ping or names another
 * root, or the socket of a late heartbeat is in use.
 */
async function servingDaemon(
  root: AbsolutePath,
  record: DaemonRecord | null,
  io: CliIo,
): Promise<Serving | null | number> {
  const id = idOf(root);
  const computed = socketPathFor(id);
  const recorded = record?.socketPath === computed ? null : record;
  const fresh =
    recorded !== null && daemonLiveness(recorded, Date.now() as EpochMs).state === "alive";
  for (const socketPath of fresh ? [recorded.socketPath, computed] : [computed]) {
    const found = await servingAt(socketPath, root, id, io);
    if (found !== null) return found;
  }
  if (recorded === null || fresh) return null;
  const late = await askDaemon(recorded.socketPath, { type: "ping" }).catch(() => "busy");
  if (late === null) return null;
  const at = new Date(recorded.heartbeatAt).toISOString();
  io.stderr(
    `squeal: whether a daemon serves ${root} is unknown: ${recorded.socketPath}, the socket its store records, is in use, but the heartbeat it records is late, last at ${at}; nothing stopped\n`,
  );
  return 1;
}

/**
 * The daemon at `socketPath` when it serves `root` of id `id`; `null` when no
 * daemon answers there; or exit 1 after saying why it is not asked to stop.
 */
async function servingAt(
  socketPath: AbsolutePath,
  root: AbsolutePath,
  id: WorktreeId,
  io: CliIo,
): Promise<Serving | null | number> {
  const ping = await askDaemon(socketPath, { type: "ping" }).catch((error: Error) => error);
  if (ping === null) return null;
  if (ping instanceof Error || !ping.ok || ping.type !== "ping") {
    const answer = ping instanceof Error ? ping.message : JSON.stringify(ping);
    io.stderr(
      `squeal: whether a daemon serves ${root} is unknown: ${socketPath} answers ${answer}; nothing stopped\n`,
    );
    return 1;
  }
  if (ping.worktreeId !== id || ping.root !== root) {
    io.stderr(
      `squeal: the daemon at ${socketPath} serves ${ping.root}, not ${root}; nothing stopped\n`,
    );
    return 1;
  }
  return { socketPath, ping };
}

/**
 * No daemon answers for `root`, which is gone: exit 0 when a store keeps the
 * row of its worktree (`row`), as one does after its daemon exited, else task
 * 011-09's refusal, exit 1, since nothing tells the path from one that never
 * was a worktree (the coordinator, request `4c3a5f19`, 2026-10-31).
 */
function noDaemon(
  named: AbsolutePath,
  root: AbsolutePath,
  row: WorktreeRecord | null,
  io: CliIo,
): number {
  if (row === null) {
    io.stderr(`squeal: ${named} does not exist; nothing stopped\n`);
    return 1;
  }
  io.stdout(`No daemon running for ${root}, which does not exist; nothing stopped\n`);
  return 0;
}

/**
 * The row a store keeps for the worktree that was at `root`, read before any
 * socket is chosen; `null` when none does. The stores read are of the
 * checkout the path lay inside and of the one the CLI runs in.
 */
function savedRow({ root, ancestor }: FormerRoot, io: CliIo): WorktreeRecord | null {
  for (const dir of [ancestor, io.cwd ?? process.cwd()]) {
    const row = rowAt(dir, root);
    if (row !== null) return row;
  }
  return null;
}

/** The row at `root` in the store of the repository `dir` lies in; `null` without one. */
function rowAt(dir: AbsolutePath, root: AbsolutePath): WorktreeRecord | null {
  try {
    const worktree = findWorktreeRoot(dir);
    const commonDir = worktree === null ? null : resolveCommonDir(worktree);
    if (commonDir === null) return null;
    return readStore(commonDir, (store) => {
      const row = store.worktrees.get(idOf(root));
      return row?.root === root ? row : null;
    });
  } catch {
    return null;
  }
}

/** Why it cannot be told whether a process of `marks` still runs; `null` when it can. */
function untracedWhy(marks: DaemonMarks): string | null {
  if (process.platform !== "linux") return `processes cannot be listed on ${process.platform}`;
  return marks.group === null && marks.token === null
    ? "it leads no process group, and no token of this start was found"
    : null;
}

/** A path that is gone: the real path it had, and the real path of its nearest ancestor that is there. */
interface FormerRoot {
  readonly root: AbsolutePath;
  readonly ancestor: AbsolutePath;
}

/**
 * The real path `named` had: the real path of its nearest ancestor that is
 * there, and the names below it. `worktreeIdFor` hashed it while it existed,
 * unless one of the removed names was a symbolic link.
 */
function formerRoot(named: AbsolutePath): FormerRoot {
  const below: string[] = [];
  let at = named;
  while (lstatOrNull(at) === null) {
    below.unshift(basename(at));
    at = dirname(at);
  }
  const ancestor = realpathSync(at);
  return { root: join(ancestor, ...below), ancestor };
}

/** `worktreeIdFor` of a root that is gone: the same hash over its former real path. */
function idOf(root: AbsolutePath): WorktreeId {
  return createHash("sha256").update(root).digest("hex").slice(0, 16);
}

/**
 * The token the store records for the daemon of `ping`, whose store is found
 * by the lock file it holds open (`<common-dir>/squeal/locks/<id>.sqlite`), as
 * `squeal ps` finds it (spec 014 D2): the removed root names no common dir.
 * `null` off Linux, with no open lock of its id, or when the store's row is of
 * another root or its record of another start.
 */
function savedToken(ping: PingResponse): string | null {
  if (process.platform !== "linux") return null;
  const lock = (createProcSource().fds(ping.pid) ?? [])
    .map((target) => lockFileParts(target))
    .find((parts) => parts?.worktreeId === ping.worktreeId);
  if (lock === undefined || lock === null) return null;
  return readStore(lock.commonDir, (store) => {
    const row = store.worktrees.get(ping.worktreeId);
    const own = row?.root === ping.root && row.daemon?.startedAt === ping.startedAt;
    return own ? (row.daemon?.token ?? null) : null;
  });
}

/** `read` over the store of `commonDir`; `null` without one, or when it cannot be read. */
function readStore<T>(commonDir: AbsolutePath, read: (store: Store) => T): T | null {
  try {
    const store = openStore(commonDir, { create: false, busyTimeoutMs: STORE_BUSY_TIMEOUT_MS });
    if (isStoreOpenFailure(store)) return null;
    try {
      return read(store);
    } finally {
      store.close();
    }
  } catch {
    return null;
  }
}

/** Waits up to `ms` for process `pid` of start `start` (`null`: unread) to be gone; whether it is. */
async function processEnded(pid: number, start: number | null, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    const gone = start === null ? processGone(pid) : statOf(pid)?.start !== start;
    if (gone) return true;
    if (Date.now() > deadline) return false;
    await sleep(50);
  }
}
