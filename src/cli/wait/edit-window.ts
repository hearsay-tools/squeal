import {
  answerMoves,
  type MovesAnswer,
  movesSeq,
  movesTrusted,
} from "../../core/scheduler/rekeyed-moves.js";
import { isPending } from "../../core/state/header.js";
import type { RevisionNumber, WorktreeId } from "../../core/types/common.js";
import type { Store } from "../../core/types/store.js";
import type { TestFileKeyRecord } from "../../core/types/store-records.js";
import type { DaemonSync, SyncState } from "../status-sync.js";
import {
  type EditWindow,
  editWindow,
  heldPending,
  heldRows,
  splitNews,
  windowRefined,
} from "../status-wait-edit.js";
import type { HeldRead } from "../status-wait-held.js";
import { type HeldSlow, heldSlowNews } from "../status-wait-slow.js";
import { holdsPass, passReached } from "./synced.js";

/*
 * Row 011-331: the edit wait's window reads (lessons, defect 32), moved
 * from `waitForStatus` as they were: the moves that name the edit's test
 * files, the news and quiet of a read, and the rows it holds for.
 */

/** What the edit wait keeps between reads; started at the first read, which finds the root. */
export interface Syncing {
  sync?: DaemonSync;
  heard?: RevisionNumber;
  /** The moves' commit with the start view: a move resolved after it is the wait's (001-258). */
  sinceSeq?: number;
  window?: EditWindow | undefined;
  /** The moves' commit the window was read at: a later one is read again (S1, 001-267). */
  windowSeq?: number | null;
  /** The moves cannot name the window: the wait takes the no-files path. */
  fallback?: boolean;
  /** With `holdSlow`: the slow files pending at the first read. */
  slow?: HeldSlow;
}

/** The rows a read holds for, once it holds the daemon's pass: the window's, or every one. */
export function heldAt(
  window: EditWindow | undefined,
  seen: HeldRead,
  current: SyncState,
  fallback: boolean,
): readonly TestFileKeyRecord[] | null {
  if (window !== undefined) {
    return holdsPass(seen.header.revision, window.revision) ? heldRows(window, seen.keys) : null;
  }
  return passReached(current, seen.header.revision, fallback) ? seen.keys : null;
}

/**
 * Lessons, defect 32: once the daemon's pass is stored, the moves name the
 * window; every commit to the moves after it reads them again (S1,
 * 001-267), and a daemon registered since leaves the wait without one (B1).
 */
export function readWindow(
  store: Store,
  id: WorktreeId,
  current: SyncState,
  heard: RevisionNumber,
  syncing: Syncing,
): void {
  if (current.state !== "synced" || syncing.fallback) return;
  const seq = movesSeq(store, id);
  if (syncing.window === undefined || seq !== syncing.windowSeq) {
    // Every revision's files: a told one counts while its files are not seen through
    // (001-191); a move recorded after the window joins it (review wave 13ad, S1).
    const answer: MovesAnswer = answerMoves(
      store,
      id,
      current.revision,
      syncing.sinceSeq ?? 0,
      current.incarnation,
    );
    if (answer.state === "answered") {
      syncing.window = editWindow(store, id, heard, current.revision, answer.rekeyed);
      syncing.windowSeq = seq;
    }
    syncing.fallback = answer.state === "incomplete";
  } else if (!movesTrusted(store, id, syncing.sinceSeq ?? 0, current.incarnation)) {
    // Another daemon registered since the window was read: it names no files (B1).
    syncing.fallback = true;
  }
  if (syncing.fallback) syncing.window = undefined;
}

/** A read's transitions, quiet before the listing, the slow files and the daemon, and the held files' news. */
export interface News {
  readonly transitions: number;
  readonly quiet: boolean;
  readonly slowNews: number;
}

/**
 * The transitions a read counts and whether it is quiet before the listing,
 * the slow files and the daemon: in the window, its files' own; while the
 * files are not named, none; else every check's. Never quiet before the
 * pass, not even at the deadline: that would be defect 30 again.
 */
export function newsOf(
  window: EditWindow | undefined,
  seen: HeldRead | null,
  held: HeldSlow | undefined,
  naming: boolean,
  current: SyncState,
  fallback: boolean,
): News {
  if (window !== undefined && seen !== null) {
    // The held files' own news, outside the edit's window: named as theirs (review wave-13ak, S1).
    const slowNews = held === undefined ? 0 : heldSlowNews(held, seen.news, window.ids);
    const transitions = splitNews(window, seen.news).own + slowNews;
    const quiet =
      holdsPass(seen.header.revision, window.revision) &&
      windowRefined(window, seen.header) &&
      heldPending(window, seen.keys) === 0;
    return { transitions, quiet, slowNews };
  }
  if (naming || seen === null) return { transitions: 0, quiet: false, slowNews: 0 };
  return {
    transitions: seen.news.length,
    quiet: passReached(current, seen.header.revision, fallback) && !isPending(seen.header),
    slowNews: 0,
  };
}
