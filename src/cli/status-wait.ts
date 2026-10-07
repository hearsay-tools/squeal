import { setTimeout as sleep } from "node:timers/promises";
import { planDelta, readHeader, worktreeLiveness } from "../core/delivery/index.js";
import { worktreeIdFor } from "../core/fs/index.js";
import { isPending, runnerPartText } from "../core/state/index.js";
import {
  buildSnapshot,
  formatStatus,
  STATUS_BUSY_TIMEOUT_MS,
  withStatusStore,
} from "../core/status/index.js";
import { plural } from "../core/text.js";
import type {
  AbsolutePath,
  DaemonLiveness,
  EpochMs,
  KnownState,
  RevisionNumber,
  StatusResult,
  StatusSnapshot,
  StatusUnavailable,
  ViewEntry,
} from "../core/types/index.js";
import type { CliIo } from "./main.js";

/** How often `status --wait` reads the store. */
export const STATUS_WAIT_POLL_MS = 250;

/**
 * The shortest wait that may end on quiet. Spec 001 D2 records a revision
 * within 500 ms of quiet, so a wait that starts right after an edit would
 * otherwise read the previous revision as quiet.
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
}

/**
 * Why the wait ended: `quiet`, nothing pending at the current revision;
 * `news`, a check changed notably since the wait started; `no-daemon`, no
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
}

export type StatusWait =
  | {
      readonly outcome: StatusWaitOutcome;
      readonly waitedMs: number;
      /** Notable differences between the known states at the start and at the end (D6). */
      readonly transitions: number;
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
 * snapshot". Reads the store only, every `pollMs`. Without a validating
 * daemon nothing pending can finish, so once the settle time passed with no
 * daemon alive it returns `no-daemon` instead of `quiet` or a long timeout;
 * a daemon a hook just spawned has the settle time to record its heartbeat.
 * Pending includes the runner part of the current revision (D2 as amended).
 *
 * A new transition is found the way delivery finds one (D6): the known
 * states at the start of the wait act as a view, and any notable difference
 * from it is news. A check that broke and recovered between two reads is not.
 * A store that cannot be read at the start ends the wait at once; a read that
 * fails later (a busy lock) is skipped.
 */
export async function waitForStatus(
  cwd: AbsolutePath,
  options: StatusWaitOptions,
): Promise<StatusWait> {
  const now = options.now ?? Date.now;
  const pollMs = options.pollMs ?? STATUS_WAIT_POLL_MS;
  const settleMs = options.settleMs ?? STATUS_WAIT_SETTLE_MS;
  const started = performance.now();
  const elapsed = () => performance.now() - started;
  let start: readonly ViewEntry[] | null = null;
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
      const transitions = countNews(start, states, header.revision);
      const settled = final || elapsed() >= settleMs;
      const daemon = worktreeLiveness(store.worktrees.get(id), now());
      const outcome: StatusWaitOutcome | null =
        transitions > 0
          ? "news"
          : settled && daemon.state !== "alive"
            ? "no-daemon"
            : settled && !isPending(header)
              ? "quiet"
              : final
                ? "timeout"
                : null;
      return outcome === null
        ? null
        : { outcome, transitions, result: buildSnapshot(store, root, now()) };
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
}

function toStartView(state: KnownState): ViewEntry {
  return { check: state.check, outcome: state.outcome, fingerprint: state.fingerprint, toldAt: 0 };
}

function countNews(
  start: readonly ViewEntry[],
  states: readonly KnownState[],
  revision: RevisionNumber,
): number {
  return planDelta({
    view: start,
    states,
    isBaselineFinding: () => false,
    toldAt: 0,
    rootOf: () => null,
    revision,
  }).entries.length;
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
  const wait = await waitForStatus(io.cwd ?? process.cwd(), { timeoutMs, now });
  const result: StatusResult = wait.result;
  if (wait.outcome === "unavailable") {
    io.stdout(json ? `${JSON.stringify(result, null, 2)}\n` : formatStatus(result, now()));
    return 1;
  }
  const line = `${waitLine(wait.outcome, wait.transitions, wait.result, wait.waitedMs)}\n`;
  if (json) {
    const payload: StatusWaitPayload = {
      outcome: wait.outcome,
      waitedMs: Math.round(wait.waitedMs),
      transitions: wait.transitions,
    };
    io.stdout(`${JSON.stringify({ ...result, wait: payload }, null, 2)}\n`);
    io.stderr(line);
  } else {
    io.stdout(`${line}\n${formatStatus(result, now())}`);
  }
  return 0;
}

function waitLine(
  outcome: StatusWaitOutcome,
  transitions: number,
  snapshot: StatusSnapshot,
  waitedMs: number,
): string {
  const after = `after ${(waitedMs / 1_000).toFixed(1)} s`;
  const at = `at revision ${snapshot.revision}`;
  switch (outcome) {
    case "quiet":
      return `Returned on quiet: nothing pending ${at} ${after}`;
    case "news":
      return `Returned on news: ${plural(transitions, "transition")} since the wait started, ${at} ${after}`;
    case "no-daemon":
      return `Returned without a daemon: ${noDaemonText(snapshot.daemon)}; results are as of revision ${snapshot.revision}`;
    case "timeout":
      return `Returned on timeout ${after}: ${pendingText(snapshot)} ${at}`;
  }
}

/** As delivered headers word it (spec 001 D10: "no daemon running since <time>"). */
function noDaemonText(daemon: DaemonLiveness): string {
  if (daemon.state === "alive" || daemon.since === null) return "no daemon is running";
  return `no daemon has validated since ${new Date(daemon.since).toISOString()}`;
}

function pendingText(snapshot: StatusSnapshot): string {
  const checks = snapshot.counts.pending;
  const files = snapshot.testFilesWithoutChecks.pending;
  const parts = [plural(checks, "check")];
  if (files > 0) parts.push(`${plural(files, "test file")} without checks`);
  if (snapshot.runnerPartPending === true) parts.push(runnerPartText(snapshot.revision));
  return parts.length === 1
    ? `${parts[0]} pending`
    : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)} pending`;
}
