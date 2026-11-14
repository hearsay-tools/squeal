import { worktreeIdFor } from "../../core/fs/git-layout.js";
import type { DownReason, WaitLiveness } from "../../core/presence/wait.js";
import { movesSeq } from "../../core/scheduler/rekeyed-moves.js";
import { buildSnapshot } from "../../core/status/snapshot.js";
import type {
  AbsolutePath,
  EpochMs,
  RelativePath,
  RevisionNumber,
  WorktreeId,
} from "../../core/types/common.js";
import type { StatusHold } from "../../core/types/standing.js";
import type { KnownState } from "../../core/types/state.js";
import type { StatusSnapshot } from "../../core/types/status.js";
import type { Store } from "../../core/types/store.js";
import { type DaemonSync, SYNC_POLL_MS } from "../status-sync.js";
import { type EditWindow, heldPending, lastHeard, splitNews } from "../status-wait-edit.js";
import { type HeldRead, readHeld, type StartView, startView } from "../status-wait-held.js";
import { type HeldSlow, heldSlowLeft, pendingSlow } from "../status-wait-slow.js";
import { holdOfWait } from "../verdict.js";
import type { DaemonWatch, HeartbeatLapse } from "../wait-liveness.js";
import { lockedOf } from "../wait-liveness.js";
import { decideStatusWait } from "./decide.js";
import { heldAt, type News, newsOf, readWindow, type Syncing } from "./edit-window.js";
import { testFilesListed } from "./listing.js";
import { judgeWait } from "./presence.js";
import { watchOf } from "./socket.js";
import { STATUS_WAITS, type StatusRecord, type StatusWaitOutcome } from "./status-table.js";
import { fallbackOf } from "./synced.js";
import type { PollStep, StatusPoll, UnavailableEnd } from "./wait.js";

/*
 * Row 011-331: the reads of the edit wait (`status --wait`, and the file
 * wait of `run --slow --wait`), moved from `status-wait.ts` as they were;
 * its row of `STATUS_WAITS` decides each read, and `pollStatus` polls.
 */

export interface StatusWaitOptions {
  readonly timeoutMs: number;
  /** Default `STATUS_POLL_MS`. */
  readonly pollMs?: number;
  /** Default `SETTLE_MS`. */
  readonly settleMs?: number;
  /** Clock for heartbeat ages in the snapshot. Default `Date.now`. */
  readonly now?: () => EpochMs;
  /**
   * The harness session the wait runs in (`waitConsumer`): its consumers'
   * told revision starts the window (`lastHeard`). Default none.
   */
  readonly session?: string | null;
  /**
   * The agent of `session` the wait runs in, when the shell names one: only
   * that consumer's told revision counts. Default every consumer of `session`.
   */
  readonly agent?: string | null;
  /** Default `syncDaemon`; tests replace it. */
  readonly sync?: (root: AbsolutePath, pollMs: number) => DaemonSync;
  /**
   * `run --slow --wait` (task 001-282): also hold for the slow files pending
   * at the first read, the ones the request queued, until each has a result;
   * their checks' transitions are news. Default `false`: slow files never
   * hold a wait (spec 004 D9, as Stop).
   */
  readonly holdSlow?: boolean;
  /** Default `WAIT_DOWN_MS`: how long a stale record's dead socket may stay so (task 004-66). */
  readonly downMs?: number;
}

/**
 * The wait's window once the daemon named its files (lessons, defect 32):
 * the revisions from `since` to the sync pass's, the test files they
 * re-keyed, how many of those are still pending (slow ones aside), and the
 * transitions of other checks, which did not end the wait.
 */
export interface StatusWaitEdit {
  readonly since: RevisionNumber;
  readonly testFiles: number;
  readonly pending: number;
  readonly otherTransitions: number;
}

/** The slow files a `run --slow --wait` held for (`holdSlow`), and those still pending by path. */
export interface StatusWaitSlow {
  readonly held: number;
  readonly pending: readonly RelativePath[];
  /**
   * Of the wait's `transitions`, those of the held files outside the edit's
   * window (review wave-13ak, S1); 0 while the window is not known, when no
   * transition is named as the edit's either.
   */
  readonly transitions: number;
}

/** The read that ended the wait: everything but how long it waited. */
export interface StatusWaitEnded {
  readonly outcome: StatusWaitOutcome;
  /**
   * Notable differences between the known states at the start and at the
   * end (D6); with `edit`, those of the edit's test files only.
   */
  readonly transitions: number;
  readonly edit?: StatusWaitEdit;
  readonly slow?: StatusWaitSlow;
  /** With `no-daemon`: why (task 004-66). */
  readonly down?: DownReason;
  /** A heartbeat lapse the wait went on through, the daemon alive (task 004-66). */
  readonly lapse?: HeartbeatLapse;
  /** Row 011-250: the last read found no record while a daemon held the worktree's lock. */
  readonly locked?: true;
  /** With `on-hold`: the hold its verdict line names (row 011-73). */
  readonly hold?: StatusHold;
  readonly result: StatusSnapshot;
}

export type StatusWait = (StatusWaitEnded & { readonly waitedMs: number }) | UnavailableEnd;

const ROW = STATUS_WAITS.edit;

/** The edit wait's options once the command's defaults are in. */
export type EditConfig = StatusWaitOptions &
  Required<Pick<StatusWaitOptions, "pollMs" | "settleMs" | "sync">>;

/**
 * The edit wait's poll: each read in the store's transaction, as
 * `waitForStatus` read it before the move (its contract is there). The
 * row decides; the hold is read only when its chain reaches it.
 */
export function editPoll(options: EditConfig): StatusPoll<StatusWaitEnded> {
  const now = options.now ?? Date.now;
  let start: StartView | null = null;
  let watch: DaemonWatch | undefined;
  const syncing: Syncing = {};
  return {
    name: "edit",
    // Edit: no read took the start view yet.
    first: () => start === null,
    sync: () => syncing.sync,
    read: ({ store, root, commonDir }, final, elapsed): PollStep<StatusWaitEnded> => {
      const id = worktreeIdFor(root);
      if (start === null) {
        // The edit's files are not known yet: the start view is every state (task 011-42).
        const states = store.knownStates.list(id);
        start = startView(states);
        startSlow(store, id, states, options.holdSlow === true, syncing);
      }
      const view = start;
      const revision = store.revisions.latest(id)?.number ?? 0;
      syncing.heard ??= lastHeard(
        store,
        id,
        revision,
        options.session ?? null,
        options.agent ?? null,
      );
      const heard = syncing.heard;
      syncing.sync ??= options.sync(root, Math.min(options.pollMs, SYNC_POLL_MS));
      const current = syncing.sync.current();
      readWindow(store, id, current, heard, syncing);
      const window = syncing.window;
      const held = syncing.slow;
      const heldFiles = held === undefined ? [] : [...held.values()];
      const settled = final || elapsed() >= options.settleMs;
      const fallback = fallbackOf(ROW, settled);
      watch ??= watchOf(id, commonDir, options.downMs);
      const { view: daemon, at } = judgeWait(watch, store, id, now);
      // Which files are the edit's is not known yet: no check's news is the edit's.
      const naming =
        window === undefined &&
        (current.state === "pending" || (current.state === "synced" && !syncing.fallback));
      // Task 011-42: a poll reads the files it holds for; the fallback holds for every one.
      const files =
        window !== undefined ? [...window.files, ...heldFiles] : naming ? heldFiles : null;
      // A window of no files still reads the revision and its runner part.
      const seen = naming && heldFiles.length === 0 ? null : readHeld(store, id, view, files);
      const slowLeft =
        held === undefined || seen === null ? [] : heldSlowLeft(held, seen.states, seen.keys);
      const news = newsOf(window, seen, held, naming, current, fallback);
      // A lapsed heartbeat decides nothing: the daemon may be mid-run (review wave 4.5, S2; 004-66).
      const quiet =
        news.quiet &&
        seen !== null &&
        testFilesListed(store, id, seen.header) &&
        slowLeft.length === 0 &&
        daemon.state === "alive";
      const record: StatusRecord = {
        store: "read",
        late: final,
        settled,
        daemon: daemon.state,
        news: news.transitions,
        quiet,
      };
      let hold: StatusHold | null = null;
      let step = decideStatusWait(ROW, record);
      if (step.kind === "read") {
        // Row 011-73 (C6 as amended 2026-10-21): at a read that holds the sync pass, which read
        // the index first, a file it holds for queued on hold ends the wait with the hold.
        const holding =
          seen === null || naming || quiet || news.transitions > 0 || daemon.state !== "alive"
            ? null
            : heldAt(window, seen, current, fallback);
        const slowRows =
          seen === null ? [] : seen.keys.filter((row) => slowLeft.includes(row.testFile.path));
        hold = holding === null ? null : holdOfWait(store, id, [...holding, ...slowRows], at);
        step = decideStatusWait(ROW, { ...record, hold });
      }
      if (step.kind !== "end") return null;
      const outcome = step.outcome as StatusWaitOutcome;
      const ended = { outcome, view, window, seen, held, slowLeft, news, daemon, hold };
      return { end: endOf({ store, root }, id, ended, watch, now) };
    },
  };
}

/** What the read that ends the wait read, for what the wait returns. */
interface EndRead {
  readonly outcome: StatusWaitOutcome;
  readonly view: StartView;
  readonly window: EditWindow | undefined;
  readonly seen: HeldRead | null;
  readonly held: HeldSlow | undefined;
  readonly slowLeft: readonly RelativePath[];
  readonly news: News;
  readonly daemon: WaitLiveness;
  readonly hold: StatusHold | null;
}

/** The wait ends: the other checks' transitions it names read every state, once. */
function endOf(
  { store, root }: { readonly store: Store; readonly root: AbsolutePath },
  id: WorktreeId,
  { outcome, view, window, seen, held, slowLeft, news, daemon, hold }: EndRead,
  watch: DaemonWatch,
  now: () => EpochMs,
): StatusWaitEnded {
  const edit: StatusWaitEdit | undefined =
    window === undefined
      ? undefined
      : {
          since: window.since,
          testFiles: window.ids.size,
          pending: seen === null ? 0 : heldPending(window, seen.keys),
          otherTransitions:
            splitNews(window, readHeld(store, id, view, null).news).other - news.slowNews,
        };
  const result = buildSnapshot(store, root, now());
  const slow =
    held === undefined
      ? {}
      : { slow: { held: held.size, pending: slowLeft, transitions: news.slowNews } };
  const lapse = watch.lapse();
  return {
    outcome,
    transitions: news.transitions,
    ...(edit === undefined ? {} : { edit }),
    ...slow,
    ...(daemon.state === "down" ? { down: daemon.reason } : {}),
    ...lockedOf(daemon),
    ...(lapse === null ? {} : { lapse }),
    ...(hold === null ? {} : { hold }),
    result,
  };
}

/** At the first read, after the start view: the moves' commit, and with `holdSlow` the slow files pending. */
function startSlow(
  store: Store,
  id: WorktreeId,
  states: readonly KnownState[],
  holdSlow: boolean,
  syncing: Syncing,
): void {
  syncing.sinceSeq = movesSeq(store, id) ?? 0;
  if (holdSlow) syncing.slow = pendingSlow(store, id, states, store.testFileKeys.list(id));
}
