import { setTimeout as sleep } from "node:timers/promises";
import { withStores } from "../core/commit/at-keys-checkout.js";
import { ensureDaemonProcess, probeDaemon } from "../core/daemon/ensure.js";
import { squealVersion } from "../core/daemon/version.js";
import { pidNamespace } from "../core/delivery/harness-process.js";
import { TREE_PRINT_TIMEOUT_MS, treePrint } from "../core/delivery/stopped.js";
import { resolveCommonDir, worktreeIdFor } from "../core/fs/git-layout.js";
import { readStop } from "../core/presence/stored.js";
import { holderGone, holdName } from "../core/scheduler/command-hold.js";
import { readCommandHolds } from "../core/scheduler/hold-rows.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { Store } from "../core/types/store.js";
import { keptCacheCli } from "../harness/shared/version-copies.js";
import type { CliIo } from "./main.js";
import { startCommand } from "./start.js";
import { SPAWN_WAIT_MS } from "./start-ready.js";
import { lockFreed, STOP_BOUNDS } from "./stop.js";
import { BUSY_BOUND_MS } from "./store-writes.js";

/*
 * Spec 023 D7.3 (row 023-40; review wave-23 B1 and S1; row 023-40c, D7.3
 * as amended 2026-11-21): how a `status --at` call starts the two daemons.
 * The commit daemon is spawned in its tree (as `squeal start` spawns one)
 * and owns the worktree from its spawn (`ownedByStart`, written by the
 * caller), so the call waits only until it answers on its socket, at most
 * until the call's bound; one that exits first ends the wait at once. The
 * working tree's daemon is started as `squeal start` starts one, its waits
 * cut to what is left of the call's, but never while the user stopped it
 * (`squeal stop`, `--until-start` too) or a command holds it (`squeal
 * hold`): the call leaves both as they are (the coordinator's decision of
 * 2026-11-21).
 */

/** At most this long the call waits for a spawned commit daemon to answer, even with a bare `--wait`. */
export const SERVE_WAIT_MS = 60_000;
const SERVE_POLL_MS = 100;

/** A daemon a start left serving, or starting: whether its process still lives, and its pid when spawned. */
export interface Started {
  readonly lives: () => Promise<boolean>;
  /** The spawned process; absent: one already served. */
  readonly pid?: number;
}

/** Starts the commit daemon in `tree`; why not, when it could not. */
export type StartCommit = (tree: AbsolutePath) => Promise<Started | string>;

/** Spawns the commit daemon as `squeal start` spawns one; returns at the spawn, not when it serves. */
export async function spawnCommitDaemon(tree: AbsolutePath): Promise<Started | string> {
  const script = process.argv[1];
  let cli: string | undefined;
  try {
    cli = script === undefined ? undefined : keptCacheCli(script, squealVersion(), process.env);
  } catch (error) {
    return `could not retain the seed runtime: ${String(error)}`;
  }
  const { result, pid, ended } = await ensureDaemonProcess(tree, cli === undefined ? {} : { cli });
  if (result === "unavailable") return `no daemon could be reached or started for ${tree}`;
  if (result === "alive") return lockHolder(tree);
  return { lives: async () => !ended(), ...(pid === null ? {} : { pid }) };
}

/** A daemon that already answers: it lives while its lock is held. */
export function lockHolder(root: AbsolutePath): Started {
  return { lives: async () => (await lockFreed(root, null, 0)).state !== "free" };
}

/**
 * Row 023-40c: waits until the commit daemon `started` answers on the
 * socket of `tree`: `null` then, else why not. One that exits first ends
 * the wait at once; the wait ends at `bound` (the call's), and never later
 * than `SERVE_WAIT_MS` after it began. The daemon owns the worktree from
 * its spawn, so ending the wait leaves nothing unowned.
 */
export async function serveWait(
  tree: AbsolutePath,
  started: Started,
  bound: number,
): Promise<string | null> {
  const until = Math.min(Date.now() + SERVE_WAIT_MS, bound);
  for (;;) {
    const left = until - Date.now();
    const probe = await probeDaemon(tree, Math.max(50, Math.min(1_000, left)));
    if (probe.state === "alive") return null;
    if (!(await started.lives())) return `the commit daemon exited before it served ${tree}`;
    if (Date.now() >= until)
      return Date.now() >= bound
        ? `the call's wait ended before the commit daemon in ${tree} answered (starting)`
        : `the commit daemon in ${tree} did not answer in ${SERVE_WAIT_MS / 1000} s`;
    await sleep(Math.min(SERVE_POLL_MS, Math.max(0, until - Date.now())));
  }
}

/**
 * Review wave-23 S1: why the working tree's daemon must not be started
 * now, `null` when it may: the user stopped it and the mark holds as a
 * hook boundary reads it (`stopHolds`: `--until-start`, or the tree as it
 * was at the stop), or a command holds it whose process lives and whose
 * bound has not passed.
 */
export async function worktreeStops(root: AbsolutePath): Promise<string | null> {
  const commonDir = resolveCommonDir(root);
  if (commonDir === null) return null;
  return withStores(commonDir, async (main) => (main === null ? null : stopsOf(main, root)));
}

async function stopsOf(main: Store, root: AbsolutePath): Promise<string | null> {
  const id = worktreeIdFor(root);
  const mark = readStop(main, id);
  if (mark !== null) {
    const tree = mark.untilStart === true ? null : await treePrint(root, TREE_PRINT_TIMEOUT_MS);
    if (mark.untilStart === true || tree === null || tree === mark.tree)
      return "the daemon is stopped (squeal stop); squeal start resumes it";
  }
  const namespace = pidNamespace();
  const now = Date.now();
  const held = readCommandHolds(main, id).filter(
    (entry) => entry.until > now && !holderGone(entry, namespace),
  );
  const first = held[0];
  if (first === undefined) return null;
  return `the daemon is held (squeal hold ${holdName(first)}); it validates again when the command ends`;
}

/**
 * `squeal start <root>`, its status output dropped, each of its waits
 * ending by `bound` (row 023-40c): its error lines are
 * the answer, and on success its stderr lines (a warning) go to `note`.
 */
export async function quietStart(
  root: AbsolutePath,
  note: (text: string) => void,
  bound: number = Number.POSITIVE_INFINITY,
): Promise<string | null> {
  const errors: string[] = [];
  const io: CliIo = { stdout: () => undefined, stderr: (text) => errors.push(text) };
  // Row 023-40c (D7.3 as amended): every wait of the start gets what is left of the call's.
  const left = (ms: number) => Math.max(0, Math.min(ms, bound - Date.now()));
  const bounds = {
    socketMs: left(STOP_BOUNDS.socketMs),
    lockMs: left(STOP_BOUNDS.lockMs),
    leftoversMs: left(STOP_BOUNDS.leftoversMs),
  };
  const code = await startCommand([root], io, bounds, left(BUSY_BOUND_MS), left(SPAWN_WAIT_MS));
  const text = errors.join("").trim().replace(/\s+/g, " ");
  if (code === 0) {
    for (const line of errors.join("").split("\n")) if (line.trim() !== "") note(line);
    return null;
  }
  return text === "" ? `squeal start exited ${code}` : text;
}
