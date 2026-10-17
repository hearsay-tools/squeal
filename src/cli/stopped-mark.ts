import { clearStopped, markStopped, treePrint } from "../core/delivery/stopped.js";
import { resolveCommonDir, worktreeIdFor } from "../core/fs/index.js";
import { isStoreOpenFailure, openStore } from "../core/store/index.js";
import type { AbsolutePath, Store } from "../core/types/index.js";

/** How long the CLI waits for the store's lock to record or clear the mark. */
const MARK_BUSY_TIMEOUT_MS = 2_000;

/** How long `squeal stop` gives git to print the tree it leaves. */
const STOP_TREE_TIMEOUT_MS = 10_000;

/**
 * Task 011-08: `squeal stop` leaves the worktree's stopped mark, with its
 * tree as git prints it now, so no hook boundary starts a daemon until the
 * next edit or `squeal start`. Nothing without a store: no daemon ran there,
 * and a hook without one starts nothing at a boundary. The error when the
 * mark could not be written, else `null`.
 */
export async function leaveStoppedMark(root: AbsolutePath, at: number): Promise<string | null> {
  const tree = await treePrint(root, STOP_TREE_TIMEOUT_MS);
  return withStore(root, (store, id) => markStopped(store, id, at, tree));
}

/** `squeal start` clears the stopped mark; the error when it could not, else `null`. */
export function clearStoppedMark(root: AbsolutePath): string | null {
  return withStore(root, (store, id) => clearStopped(store, id));
}

function withStore(root: AbsolutePath, write: (store: Store, id: string) => void): string | null {
  try {
    const commonDir = resolveCommonDir(root);
    if (commonDir === null) return null;
    const store = openStore(commonDir, { create: false, busyTimeoutMs: MARK_BUSY_TIMEOUT_MS });
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
