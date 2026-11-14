import type { RevisionNumber } from "../../core/types/common.js";
import type { SyncState } from "../status-sync.js";
import type { FileClasses } from "../verdict.js";
import type { StatusRow } from "./status-table.js";

/*
 * Row 011-331: "has the daemon's pass reached this read", one rule for
 * every status wait (lessons, defect 30). Before the move it was decided in
 * five places: the edit wait's `isSynced` and its window's revision, the
 * named wait's `readiness`, the snapshot's `ready`, and `unsynced` for the
 * verdict at a timeout. They differ only in what a daemon that cannot sync
 * means (the row's `unsupported` cell) and in the listing gate of a
 * selection, kept here beside it.
 */

/**
 * A read at `revision` holds the daemon's pass over the edits made before
 * the wait: the store's revision reached the one the pass left (`synced`).
 * A daemon that cannot sync (`unsupported`) counts when `fallback` says so:
 * the settle time passed, by the row's `unsupported` cell. A pending sync
 * never counts.
 */
export function passReached(sync: SyncState, revision: RevisionNumber, fallback: boolean): boolean {
  if (sync.state === "synced") return holdsPass(revision, sync.revision);
  return sync.state === "unsupported" && fallback;
}

/** The comparison itself: a read at `revision` holds a pass the daemon stored at `pass`. */
export function holdsPass(revision: RevisionNumber, pass: RevisionNumber): boolean {
  return revision >= pass;
}

/** Whether a daemon that cannot sync counts at a read, by `row`'s `unsupported` cell. */
export function fallbackOf(row: StatusRow, settled: boolean): boolean {
  return row.unsupported === "after settle" && settled;
}

/**
 * Whether a named wait or snapshot may decide its selection at this read:
 * the pass reached the selected files' revision, and, once the daemon
 * synced, the runner listed that revision's test files. A daemon that
 * cannot sync gives no listing to wait for.
 */
export function selectionReady(sync: SyncState, all: FileClasses, fallback: boolean): boolean {
  return passReached(sync, all.revision, fallback) && !(sync.state === "synced" && all.unlisted);
}
