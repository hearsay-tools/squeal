import { existsSync } from "node:fs";
import { join } from "node:path";
import { POLICY_FILE } from "../core/daemon/policy.js";
import { treePrint } from "../core/delivery/stopped.js";
import { clearStopped, markStopped } from "../core/presence/events.js";
import type { AbsolutePath, EpochMs } from "../core/types/common.js";
import type { Store } from "../core/types/store.js";
import { type WriteWithinOptions, writeWithin } from "./store-writes.js";

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
 * Squeal (`usesSqueal`). Spec 021 D1 (#158): a busy store is asked again
 * until `busyBoundMs`; past it, the error says so and names the lock's holder.
 */
export function leaveStoppedMark(
  root: AbsolutePath,
  at: number,
  tree: string | null,
  untilStart = false,
  busyBoundMs?: number,
): StopMarkResult {
  let until = false;
  const write = (store: Store, id: string) => {
    until = markStopped(store, id, at as EpochMs, tree, untilStart);
  };
  const create = untilStart && existsSync(join(root, POLICY_FILE));
  const error = withStore(root, write, { create, boundMs: busyBoundMs });
  // Without a store or a policy file no hook starts a daemon: `squeal start` alone does.
  return { error, untilStart: error === null && (until || untilStart) };
}

/**
 * `squeal start` clears the stopped mark; the error when it could not, else
 * `null`. Spec 021 D1 (#108): asked again while the store is busy, as
 * `leaveStoppedMark` is.
 */
export function clearStoppedMark(root: AbsolutePath, busyBoundMs?: number): string | null {
  return withStore(root, (store, id) => clearStopped(store, id), { boundMs: busyBoundMs });
}

/** The mark's write in one transaction, through `writeWithin`; its error, `null` once written or with no store. */
function withStore(
  root: AbsolutePath,
  write: (store: Store, id: string) => void,
  options: WriteWithinOptions,
): string | null {
  const written = writeWithin(
    root,
    (store, id) => store.transaction(() => write(store, id)),
    options,
  );
  return "not" in written && written.not !== "none" ? written.why : null;
}
