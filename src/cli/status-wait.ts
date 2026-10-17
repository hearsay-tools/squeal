import { setTimeout as sleep } from "node:timers/promises";
import { planDelta, readHeader } from "../core/delivery/index.js";
import { worktreeIdFor } from "../core/fs/index.js";
import {
  answerMoves,
  type MovesAnswer,
  movesSeq,
  movesTrusted,
} from "../core/scheduler/rekeyed-moves.js";
import { isPending } from "../core/state/index.js";
import {
  buildSnapshot,
  formatStatus,
  STATUS_BUSY_TIMEOUT_MS,
  withStatusStore,
} from "../core/status/index.js";
import type {
  AbsolutePath,
  DeltaEntry,
  EpochMs,
  KnownState,
  RelativePath,
  RevisionNumber,
  StatusResult,
  StatusSnapshot,
  StatusUnavailable,
  ViewEntry,
} from "../core/types/index.js";
import type { CliIo } from "./main.js";
import { statusCommand } from "./status-command.js";
import { type DaemonSync, type SyncState, syncDaemon } from "./status-sync.js";
import {
  type EditWindow,
  editWindow,
  heldPending,
  lastHeard,
  splitNews,
  windowRefined,
} from "./status-wait-edit.js";
import { waitLine } from "./status-wait-lines.js";
import { namedWaitCommand } from "./status-wait-paths.js";
import { type HeldSlow, heldSlowLeft, heldSlowNews, pendingSlow } from "./status-wait-slow.js";
import {
  type DaemonWatch,
  type DownReason,
  type HeartbeatLapse,
  watchDaemon,
} from "./wait-liveness.js";

/** How often `status --wait` reads the store. */
export const STATUS_WAIT_POLL_MS = 250;

/**
 * The shortest wait that may end without a daemon, which a daemon a hook
 * just spawned needs to record its heartbeat, and the shortest that may end
 * on quiet when no daemon can sync (one from before the `sync` request). A
 * daemon that syncs decides quiet instead (lessons, defect 30).
 */
export const STATUS_WAIT_SETTLE_MS = 750;

export interface StatusWaitOptions {
  readonly timeoutMs: number;
  /** Default `STATUS_WAIT_POLL_MS`. */
  readonly pollMs?: number;
  /** Default `STATUS_WAIT_SETTLE_MS`. */
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
 * Why the wait ended: `quiet`, nothing pending at the current revision, or
 * none of the edit's test files (`StatusWaitEdit`); `news`, a check, or a
 * check of the edit's test files, changed notably since the wait started; `no-daemon`, no
 * daemon is validating, so nothing pending would ever finish and quiet would
 * say nothing about the files (review wave 4.5, S2); `timeout`, none of these
 * within the given time.
 */
export type StatusWaitOutcome = "quiet" | "news" | "no-daemon" | "timeout";

/**
 * The `wait` field `status --json --wait` adds to the snapshot: the same
 * outcome as the first human line.
 */
export interface StatusWaitPayload {
  readonly outcome: StatusWaitOutcome;
  readonly waitedMs: number;
  readonly transitions: number;
  /** Present when the daemon named the edit's test files (task 001-186). */
  readonly edit?: StatusWaitEdit;
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

export type StatusWait =
  | {
      readonly outcome: StatusWaitOutcome;
      readonly waitedMs: number;
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
      readonly result: StatusSnapshot;
    }
  | {
      readonly outcome: "unavailable";
      readonly waitedMs: number;
      readonly result: StatusUnavailable;
    };

/**
 * Spec 001 D7: "`squeal status --wait <ms>` blocks until nothing is pending
 * at the current revision or a new transition is recorded, then prints the
 * snapshot". Reads the store every `pollMs`. Without a validating daemon
 * nothing pending can finish, so once the settle time passed with no daemon
 * alive it returns `no-daemon` instead of `quiet` or a long timeout; a
 * daemon a hook just spawned has the settle time to record its heartbeat.
 * Pending includes the runner part of the current revision (D2 as amended).
 *
 * Quiet is decided at a revision that holds every edit made before the wait
 * (lessons, defect 30): the daemon is asked for a reconciliation pass at the
 * start (`syncDaemon`), and quiet waits until the store's revision reached
 * the one that pass left. On a loaded host the edit's revision committed up
 * to 3.1 s after the edit, past any fixed delay. A daemon that cannot sync
 * falls back to the settle time.
 *
 * A new transition is found the way delivery finds one (D6): the known
 * states at the start of the wait act as a view, and any notable difference
 * from it is news. A check that broke and recovered between two reads is not.
 * A store that cannot be read at the start ends the wait at once; a read that
 * fails later (a busy lock) is skipped.
 *
 * Lessons, defect 32 (tasks 001-186, 001-191): once the store's refined
 * revision reached the pass's, the store's re-key moves name the test files
 * every revision up to it re-keyed, those whose move had its result since
 * the start view included (`answerMoves`, task 001-258), and the window
 * keeps those of the revisions since the wait last heard and of earlier
 * ones not yet seen through (`lastHeard`, `editWindow`). Then quiet is none
 * of those files pending, slow ones aside, whatever else runs, and news is
 * a transition of one of their checks; until the moves are read, neither.
 * Every commit to the moves after the window reads them again, so a move
 * recorded later joins it (review wave 13ad, S1, task 001-267).
 * A daemon that names no incarnation (one before task 001-268) or cannot
 * sync, moves lost since the start, and a record that incarnation did not
 * write last or a daemon registered since, read before the window or at any
 * read after it (`movesTrusted`, review waves 13ac and 13ad, B1), leave the
 * wait as before: nothing pending at all, and any check's news.
 *
 * With `holdSlow` (task 001-282), quiet also needs every slow file pending
 * at the first read to have its result, and their transitions are news.
 *
 * Task 004-66 (issue 12): a stale heartbeat is no daemon only once
 * `watchDaemon` finds none, a cleared record or a socket dead for `downMs`;
 * a daemon whose heartbeat lapsed keeps the wait going, and the line says so.
 */
export async function waitForStatus(
  cwd: AbsolutePath,
  options: StatusWaitOptions,
): Promise<StatusWait> {
  const now = options.now ?? Date.now;
  const pollMs = options.pollMs ?? STATUS_WAIT_POLL_MS;
  const settleMs = options.settleMs ?? STATUS_WAIT_SETTLE_MS;
  const startSync = options.sync ?? syncDaemon;
  const session = options.session ?? null;
  const agent = options.agent ?? null;
  const started = performance.now();
  const elapsed = () => performance.now() - started;
  let start: readonly ViewEntry[] | null = null;
  let watch: DaemonWatch | undefined;
  // Started at the first read, which finds the root; a box, since the read is a callback.
  const syncing: {
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
  } = {};
  try {
    for (;;) {
      // The read at the deadline decides with what it finds and waits the full busy timeout.
      const final = elapsed() >= options.timeoutMs;
      const left = options.timeoutMs - elapsed();
      const busyTimeoutMs = final
        ? STATUS_BUSY_TIMEOUT_MS
        : Math.round(Math.max(50, Math.min(STATUS_BUSY_TIMEOUT_MS, left)));
      const read = withStatusStore(cwd, { busyTimeoutMs }, ({ store, root }) => {
        const id = worktreeIdFor(root);
        const states = store.knownStates.list(id);
        const header = readHeader(store, id, states);
        if (start === null) {
          start = states.map(toStartView);
          syncing.sinceSeq = movesSeq(store, id) ?? 0;
        }
        const news = newsOf(start, states, header.revision);
        syncing.heard ??= lastHeard(store, id, header.revision, session, agent);
        const heard = syncing.heard;
        syncing.sync ??= startSync(root, pollMs);
        const current = syncing.sync.current();
        if (current.state === "synced" && !syncing.fallback) {
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
        const window = syncing.window;
        const keys =
          window === undefined && options.holdSlow !== true ? [] : store.testFileKeys.list(id);
        if (options.holdSlow === true) syncing.slow ??= pendingSlow(store, id, states, keys);
        const held = syncing.slow;
        const slowLeft = held === undefined ? [] : heldSlowLeft(held, states, keys);
        const settled = final || elapsed() >= settleMs;
        watch ??= watchDaemon(id, { downMs: options.downMs });
        const daemon = watch.judge(store.worktrees.get(id)?.daemon ?? null, now());
        // Never quiet before the pass, not even at the deadline: that would be defect 30 again.
        let transitions: number;
        let quiet: boolean;
        let edit: StatusWaitEdit | undefined;
        // The held files' own news, outside the edit's window: named as theirs (review wave-13ak, S1).
        let slowNews = 0;
        if (window !== undefined) {
          const split = splitNews(window, news);
          const pending = heldPending(window, keys);
          slowNews = held === undefined ? 0 : heldSlowNews(held, news, window.ids);
          transitions = split.own + slowNews;
          quiet =
            header.revision >= window.revision && windowRefined(window, header) && pending === 0;
          edit = {
            since: window.since,
            testFiles: window.ids.size,
            pending,
            otherTransitions: split.other - slowNews,
          };
        } else if (
          current.state === "pending" ||
          (current.state === "synced" && !syncing.fallback)
        ) {
          // Which files are the edit's is not known yet: no check's news is the edit's.
          transitions = 0;
          quiet = false;
        } else {
          transitions = news.length;
          quiet = isSynced(current, header.revision, settled) && !isPending(header);
        }
        // A lapsed heartbeat decides nothing: the daemon may be mid-run (review wave 4.5, S2; 004-66).
        quiet &&= slowLeft.length === 0 && daemon.state === "alive";
        const outcome: StatusWaitOutcome | null =
          transitions > 0
            ? "news"
            : settled && daemon.state === "down"
              ? "no-daemon"
              : quiet
                ? "quiet"
                : final
                  ? "timeout"
                  : null;
        if (outcome === null) return null;
        const result = buildSnapshot(store, root, now());
        const slow =
          held === undefined
            ? {}
            : { slow: { held: held.size, pending: slowLeft, transitions: slowNews } };
        const lapse = watch.lapse();
        return {
          outcome,
          transitions,
          ...(edit === undefined ? {} : { edit }),
          ...slow,
          ...(daemon.state === "down" ? { down: daemon.reason } : {}),
          ...(lapse === null ? {} : { lapse }),
          result,
        };
      });
      if (read !== null && "available" in read) {
        if (start === null || final) {
          return { outcome: "unavailable", waitedMs: elapsed(), result: read };
        }
      } else if (read !== null) {
        return { ...read, waitedMs: elapsed() };
      }
      const remaining = options.timeoutMs - elapsed();
      if (remaining > 0) await sleep(Math.min(pollMs, remaining));
    }
  } finally {
    syncing.sync?.stop();
  }
}

/**
 * Quiet may be decided at `revision`: it holds the daemon's pass, or no
 * daemon can sync and the settle time passed.
 */
function isSynced(current: SyncState, revision: RevisionNumber, settled: boolean): boolean {
  if (current.state === "synced") return revision >= current.revision;
  return current.state === "unsupported" && settled;
}

function toStartView(state: KnownState): ViewEntry {
  return { check: state.check, outcome: state.outcome, fingerprint: state.fingerprint, toldAt: 0 };
}

function newsOf(
  start: readonly ViewEntry[],
  states: readonly KnownState[],
  revision: RevisionNumber,
): readonly DeltaEntry[] {
  return planDelta({
    view: start,
    states,
    isBaselineFinding: () => false,
    toldAt: 0,
    rootOf: () => null,
    revision,
  }).entries;
}

/**
 * The consumer a wait runs as, from its shell: the session from
 * `CLAUDE_CODE_SESSION_ID`, `CODEX_SESSION_ID` or `OPENCODE_SESSION_ID`, and,
 * for OpenCode alone, the agent from `OPENCODE_AGENT_ID` (`main` for a root
 * session, the child session's id for a child, spec 008 D2), so a child's pull
 * is credited to `(root, child)`. Codex's shell names no agent: every consumer
 * of its session counts.
 */
export function waitConsumer(env: Readonly<Record<string, string | undefined>>): {
  readonly session: string | null;
  readonly agent: string | null;
} {
  const session = env.CLAUDE_CODE_SESSION_ID ?? env.CODEX_SESSION_ID ?? null;
  if (session !== null) return { session, agent: null };
  const opencode = env.OPENCODE_SESSION_ID;
  if (opencode === undefined || opencode === "") return { session: null, agent: null };
  const agent = env.OPENCODE_AGENT_ID;
  return { session: opencode, agent: agent === undefined || agent === "" ? null : agent };
}

/**
 * Task 004-66 (issue 12): `run --slow --wait`'s code once its wait ended, 3
 * when the slow files its request queued have no verdict, since no daemon
 * will run them or the deadline passed first, as a named wait's (spec 005
 * D1); else 0.
 */
export function slowWaitCode(wait: Extract<StatusWait, { result: StatusSnapshot }>): 0 | 3 {
  if (wait.outcome === "no-daemon") return 3;
  return wait.outcome === "timeout" && (wait.slow?.pending.length ?? 0) > 0 ? 3 : 0;
}

/**
 * `squeal status [--json] --wait <ms>`. Exit code 0 on quiet, news, no daemon
 * or timeout, but `slowWaitCode`'s with `holdSlow`; 1 when status is unavailable. The line saying why the wait
 * ended comes last in the human rendering, after the snapshot (issue 26), and goes to stderr with `--json`,
 * where stdout is the snapshot payload plus a `wait` field
 * (`StatusWaitPayload`) with the same outcome. `holdSlow` is
 * `run --slow --wait`'s (`StatusWaitOptions`). With `paths`, the wait is
 * spec 005 D2's on the test files they select (`namedWaitCommand`).
 */
export async function statusWaitCommand(
  timeoutMs: number,
  json: boolean,
  io: CliIo,
  holdSlow = false,
  paths: readonly string[] = [],
): Promise<number> {
  const now = io.now ?? Date.now;
  const env = io.env ?? process.env;
  if (paths.length > 0) {
    const pollMs = STATUS_WAIT_POLL_MS;
    const settleMs = STATUS_WAIT_SETTLE_MS;
    return namedWaitCommand(paths, json, io, {
      timeoutMs,
      pollMs,
      settleMs,
      now,
      sync: syncDaemon,
    });
  }
  const wait = await waitForStatus(io.cwd ?? process.cwd(), {
    timeoutMs,
    now,
    ...waitConsumer(env),
    holdSlow,
  });
  const result: StatusResult = wait.result;
  if (wait.outcome === "unavailable") {
    io.stdout(json ? `${JSON.stringify(result, null, 2)}\n` : formatStatus(result, now()));
    return 1;
  }
  const line = `${waitLine(wait, statusCommand(env))}\n`;
  if (json) {
    const payload: StatusWaitPayload = {
      outcome: wait.outcome,
      waitedMs: Math.round(wait.waitedMs),
      transitions: wait.transitions,
      ...(wait.edit === undefined ? {} : { edit: wait.edit }),
    };
    io.stdout(`${JSON.stringify({ ...result, wait: payload }, null, 2)}\n`);
    io.stderr(line);
  } else {
    io.stdout(`${formatStatus(result, now(), statusCommand(env))}\n${line}`);
  }
  return holdSlow ? slowWaitCode(wait) : 0;
}
