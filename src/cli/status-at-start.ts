import { setTimeout as sleep } from "node:timers/promises";
import { readCommitWorktree } from "../core/checkout/commit-worktree.js";
import { withStores } from "../core/commit/at-keys-checkout.js";
import { ensureDaemonProcess } from "../core/daemon/ensure.js";
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
import { lockFreed } from "./stop.js";

/*
 * Spec 023 D7.3 (row 023-40; review wave-23 B1 and S1): how a `status --at`
 * call starts the two daemons. The commit daemon is spawned in its tree,
 * and the call, its worktree's creator, stays until the daemon claims the
 * worktree (023-38 notes: before the claim the creator owns it, and a
 * sweep in that gap would remove it); it stops waiting at once when the
 * daemon exits first, and past the call's wait it waits at most
 * `CLAIM_GRACE_MS` more, while the daemon lives. The working tree's daemon
 * is started as `squeal start` starts one, but never while the user
 * stopped it (`squeal stop`, `--until-start` too) or a command holds it
 * (`squeal hold`): the call leaves both as they are (the coordinator's
 * decision of 2026-11-21).
 */

/** How long the call waits for a started commit daemon to claim its worktree. */
export const CLAIM_WAIT_MS = 60_000;
/** Past the call's wait, how much longer it waits for a live daemon's claim. */
export const CLAIM_GRACE_MS = 10_000;
const CLAIM_POLL_MS = 200;

/** A daemon a start left serving, or starting: whether its process still lives. */
export interface Started {
  readonly lives: () => Promise<boolean>;
}

/** Starts the commit daemon in `tree`; why not, when it could not. */
export type StartCommit = (tree: AbsolutePath) => Promise<Started | string>;

/** Spawns the commit daemon as `squeal start` spawns one; returns at the spawn, not at its claim. */
export async function spawnCommitDaemon(tree: AbsolutePath): Promise<Started | string> {
  const script = process.argv[1];
  let cli: string | undefined;
  try {
    cli = script === undefined ? undefined : keptCacheCli(script, squealVersion(), process.env);
  } catch (error) {
    return `could not retain the seed runtime: ${String(error)}`;
  }
  const { result, ended } = await ensureDaemonProcess(tree, cli === undefined ? {} : { cli });
  if (result === "unavailable") return `no daemon could be reached or started for ${tree}`;
  if (result === "alive") return lockHolder(tree);
  return { lives: async () => !ended() };
}

/** A daemon that already answers: it lives while its lock is held. */
export function lockHolder(root: AbsolutePath): Started {
  return { lives: async () => (await lockFreed(root, null, 0)).state !== "free" };
}

/**
 * Waits until the daemon `started` claimed `tree`: `null` then, else why
 * not. Review wave-23 B1: a daemon that exits first ends the wait at once;
 * the wait ends `CLAIM_GRACE_MS` past `deadline` (the call's) at the
 * latest, and never later than `CLAIM_WAIT_MS` after it began.
 */
export async function claimWait(
  tree: AbsolutePath,
  started: Started,
  deadline: number,
): Promise<string | null> {
  const until = Math.min(Date.now() + CLAIM_WAIT_MS, deadline + CLAIM_GRACE_MS);
  for (;;) {
    if (readCommitWorktree(tree)?.daemon !== undefined) return null;
    if (!(await started.lives()))
      return readCommitWorktree(tree)?.daemon !== undefined
        ? null
        : `the commit daemon exited before it claimed ${tree}`;
    if (Date.now() >= until)
      return Date.now() >= deadline
        ? `the call's wait ended before the commit daemon claimed ${tree} (starting)`
        : `the commit daemon did not claim ${tree} in ${CLAIM_WAIT_MS / 1000} s`;
    await sleep(CLAIM_POLL_MS);
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
 * `squeal start <root>`, its status output dropped: its error lines are
 * the answer, and on success its stderr lines (a warning) go to `note`.
 */
export async function quietStart(
  root: AbsolutePath,
  note: (text: string) => void,
): Promise<string | null> {
  const errors: string[] = [];
  const io: CliIo = { stdout: () => undefined, stderr: (text) => errors.push(text) };
  const code = await startCommand([root], io);
  const text = errors.join("").trim().replace(/\s+/g, " ");
  if (code === 0) {
    for (const line of errors.join("").split("\n")) if (line.trim() !== "") note(line);
    return null;
  }
  return text === "" ? `squeal start exited ${code}` : text;
}
