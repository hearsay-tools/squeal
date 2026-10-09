import { setTimeout as sleep } from "node:timers/promises";
import { planDelta, readHeader, worktreeLiveness } from "../core/delivery/index.js";
import { worktreeIdFor } from "../core/fs/index.js";
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
   * The harness session the wait runs in (`CLAUDE_CODE_SESSION_ID`,
   * `CODEX_SESSION_ID`): its consumers' told revision starts the window
   * (`windowStart`). Default none.
   */
  readonly session?: string | null;
  /** Default `syncDaemon`; tests replace it. */
  readonly sync?: (root: AbsolutePath, pollMs: number, after: RevisionNumber) => DaemonSync;
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
 * Lessons, defect 32 (task 001-186): the pass also names the test files the
 * revisions since the wait last heard (`lastHeard`, `editWindow`) up to its own re-keyed,
 * once their runner part is applied. Then quiet is none of those files
 * pending, slow ones aside, whatever else runs, and news is a transition of
 * one of their checks; until the daemon answers, neither. A daemon that
 * names no files (one before the task) or cannot sync leaves the wait as
 * before: nothing pending at all, and any check's news.
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
  const started = performance.now();
  const elapsed = () => performance.now() - started;
  let start: readonly ViewEntry[] | null = null;
  // Started at the first read, which finds the root; a box, since the read is a callback.
  const syncing: { sync?: DaemonSync; heard?: RevisionNumber; window?: EditWindow } = {};
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
        start ??= states.map(toStartView);
        const news = newsOf(start, states, header.revision);
        syncing.heard ??= lastHeard(store, id, header.revision, session);
        const heard = syncing.heard;
        syncing.sync ??= startSync(root, pollMs, Math.max(0, heard - 1));
        const current = syncing.sync.current();
        if (current.state === "synced" && current.rekeyed !== null) {
          syncing.window ??= editWindow(store, id, heard, current.revision, current.rekeyed);
        }
        const window = syncing.window;
        const settled = final || elapsed() >= settleMs;
        const daemon = worktreeLiveness(store.worktrees.get(id), now());
        // Never quiet before the pass, not even at the deadline: that would be defect 30 again.
        let transitions: number;
        let quiet: boolean;
        let edit: StatusWaitEdit | undefined;
        if (window !== undefined) {
          const split = splitNews(window, news);
          const pending = heldPending(window, store.testFileKeys.list(id));
          transitions = split.own;
          quiet =
            header.revision >= window.revision && windowRefined(window, header) && pending === 0;
          edit = {
            since: window.since,
            testFiles: window.ids.size,
            pending,
            otherTransitions: split.other,
          };
        } else if (current.state === "pending") {
          // Which files are the edit's is not known yet: no check's news is the edit's.
          transitions = 0;
          quiet = false;
        } else {
          transitions = news.length;
          quiet = isSynced(current, header.revision, settled) && !isPending(header);
        }
        const outcome: StatusWaitOutcome | null =
          transitions > 0
            ? "news"
            : settled && daemon.state !== "alive"
              ? "no-daemon"
              : quiet
                ? "quiet"
                : final
                  ? "timeout"
                  : null;
        if (outcome === null) return null;
        const result = buildSnapshot(store, root, now());
        return { outcome, transitions, ...(edit === undefined ? {} : { edit }), result };
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
 * `squeal status [--json] --wait <ms>`. Exit code 0 on quiet, news, no daemon
 * or timeout; 1 when status is unavailable. The line saying why the wait
 * ended comes first in the human rendering and goes to stderr with `--json`,
 * where stdout is the snapshot payload plus a `wait` field
 * (`StatusWaitPayload`) with the same outcome.
 */
export async function statusWaitCommand(
  timeoutMs: number,
  json: boolean,
  io: CliIo,
): Promise<number> {
  const now = io.now ?? Date.now;
  const env = io.env ?? process.env;
  const session = env.CLAUDE_CODE_SESSION_ID ?? env.CODEX_SESSION_ID ?? null;
  const wait = await waitForStatus(io.cwd ?? process.cwd(), { timeoutMs, now, session });
  const result: StatusResult = wait.result;
  if (wait.outcome === "unavailable") {
    io.stdout(json ? `${JSON.stringify(result, null, 2)}\n` : formatStatus(result, now()));
    return 1;
  }
  const line = `${waitLine(wait)}\n`;
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
    io.stdout(`${line}\n${formatStatus(result, now(), statusCommand(env))}`);
  }
  return 0;
}
