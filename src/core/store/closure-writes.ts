import { randomBytes } from "node:crypto";
import type { MetaRepo, Store } from "../types/store.js";
import { everyDaemonClaims } from "./states-marker.js";

/*
 * Row 011-44: a cheap marker of closure writes. Each of the two writers of
 * `test_files` rows, the scheduler's `storeClosures` and the transfer
 * import's `addClosures`, sets this marker to a new random value in the
 * transaction of its rows, after them, so a reader that read
 * the marker before the rows never keeps rows older than the marker it read.
 * A named wait keeps the closures it read across polls and reads them again
 * only when the marker moved. A random value, not a counter, so a store made
 * again from nothing never repeats a value a reader holds. The key is the
 * store's, shared by every worktree, since a closure record is the
 * repository's. The writers bump, not `TestFileRepo`: the repository is on
 * the key-format guard's validity path and its cases run no closure write
 * (row 011-45 moved its removals' bump to their one caller the same way).
 * `test/cli/stored-closures.test.ts` fails when another writer appears.
 *
 * A daemon of a release before this one writes closures with no bump. The
 * coordinator's rule of 2026-11-14 (one trust rule for both store markers):
 * a reader trusts the marker only while a daemon is registered on the store
 * and every registered daemon claimed its states marker (`everyDaemonClaims`,
 * row 011-45), read in the same read transaction as the marker. Rows 011-44
 * and 011-45 ship in one release, so a daemon that claims its states marker
 * also moves this one with each closure write. With no marker, no daemon, or
 * a daemon that claims none, the reader reads every closure each time, as
 * before.
 */

/** The `meta` key of the closure-write marker. Row 011-45's state marker has its own. */
export const CLOSURE_WRITES_KEY = "closure-writes";

/** Moves the marker; call it after the `test_files` writes, in their transaction. */
export function markClosureWrite(store: Store): void {
  store.meta.set(CLOSURE_WRITES_KEY, randomBytes(8).toString("hex"));
}

/** The marker as last moved, `null` when no writer has moved it in this store. */
export function closureWrites(meta: MetaRepo): string | null {
  return meta.get(CLOSURE_WRITES_KEY);
}

/**
 * The marker as a reader may trust it: `null` with no marker, with no daemon
 * registered on the store, or once a registered daemon claims no states
 * marker, since it may write closures with no bump. Read it in the read
 * transaction of the closures it vouches for, before them.
 */
export function trustedClosureWrites(store: Store): string | null {
  const marker = closureWrites(store.meta);
  if (marker === null) return null;
  const registered = store.worktrees.list().some((w) => w.daemon !== null);
  return registered && everyDaemonClaims(store) ? marker : null;
}
