import { existsSync } from "node:fs";
import { join } from "node:path";
import { POLICY_FILE } from "../core/daemon/policy.js";
import { clearStopped, markStopped, treePrint } from "../core/delivery/stopped.js";
import { resolveCommonDir, worktreeIdFor } from "../core/fs/index.js";
import { isStoreOpenFailure, openStore } from "../core/store/index.js";
import type { AbsolutePath, EpochMs, Store } from "../core/types/index.js";

/** How long the CLI waits for the store's lock to record or clear the mark. */
const MARK_BUSY_TIMEOUT_MS = 2_000;

/** How long `squeal stop` gives git to print the tree it leaves. */
const STOP_TREE_TIMEOUT_MS = 10_000;

/** The tree as git prints it when `squeal stop` is asked, before the daemon goes. */
export function stopTree(root: AbsolutePath): Promise<string | null> {
  return treePrint(root, STOP_TREE_TIMEOUT_MS);
}

/** What `leaveStoppedMark` did: the error, or whether the mark it left is `untilStart`. */
export interface StopMarkResult {
  readonly error: string | null;
  readonly untilStart: boolean;
}

/**
 * Task 011-08: `squeal stop` leaves the worktree's stopped mark, with `tree`
 * printed when the stop was asked (`stopTree`), so no hook boundary starts a
 * daemon until the next edit or `squeal start`; an edit made while the daemon
 * shut down clears it. Row 011-254: with `untilStart` (`--until-start`), or
 * over such a mark, only `squeal start` ends it. A plain stop writes nothing
 * without a store: no daemon ran there. `untilStart` creates the store where
 * the worktree has a policy file, since SessionStart spawns a daemon there
 * when no store exists (the coordinator, 2026-10-26); without one no hook
 * starts any, and a store would make the hooks read the repository as using
 * Squeal (`usesSqueal`).
 */
export function leaveStoppedMark(
  root: AbsolutePath,
  at: number,
  tree: string | null,
  untilStart = false,
): StopMarkResult {
  let until = false;
  const write = (store: Store, id: string) => {
    until = markStopped(store, id, at as EpochMs, tree, untilStart);
  };
  const error = withStore(root, write, untilStart && existsSync(join(root, POLICY_FILE)));
  // Without a store or a policy file no hook starts a daemon: `squeal start` alone does.
  return { error, untilStart: error === null && (until || untilStart) };
}

/** `squeal start` clears the stopped mark; the error when it could not, else `null`. */
export function clearStoppedMark(root: AbsolutePath): string | null {
  return withStore(root, (store, id) => clearStopped(store, id));
}

function withStore(
  root: AbsolutePath,
  write: (store: Store, id: string) => void,
  create = false,
): string | null {
  try {
    const commonDir = resolveCommonDir(root);
    if (commonDir === null) return null;
    const store = openStore(commonDir, { create, busyTimeoutMs: MARK_BUSY_TIMEOUT_MS });
    if (isStoreOpenFailure(store)) return null;
    try {
      store.transaction(() => write(store, worktreeIdFor(root)));
      return null;
    } finally {
      store.close();
    }
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
