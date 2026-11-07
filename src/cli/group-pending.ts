import { worktreeIdFor } from "../core/fs/git-layout.js";
import { heartbeatLateBy } from "../core/presence/heartbeat.js";
import { durationText, shellWord } from "../core/text.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { GroupHolder, RunGroupResponse } from "../core/types/daemon.js";
import { inStore } from "./run-lanes.js";

/*
 * Row 011-302 (gh-154): what `squeal run <group> --wait` says when its
 * deadline passed before the daemon took the request. It names what held
 * the request as the daemon recorded it, never a guess, and the next action;
 * the request stays pending and the wait gives no verdict (exit 3).
 *
 * First what is known of the daemon's main thread: a heartbeat past its
 * grace (the store, any daemon version), a request it has not read and a
 * step it said it runs (the socket, row 011-302 on). In the gh-154
 * incident the main thread stalled for at least 111 s with no holder
 * recorded, and the socket answered meanwhile. Then the holder the main
 * thread reported: its startup, or the scheduler's lock with its operation.
 */

/**
 * How long the store may keep the heartbeat read waiting: the read only adds
 * a detail to a line the deadline already decided (review 0.1.409 B1).
 */
const HEARTBEAT_BUSY_MS = 100;

/**
 * How long the daemon of `root` has sent no heartbeat, once that is past
 * its grace; `null` while it is on time, when no daemon is recorded, or when
 * the store cannot be read within `HEARTBEAT_BUSY_MS` (busy, absent, or any
 * other failure): the line then names what the socket recorded, and exit 3
 * stays (review 0.1.409 B1).
 */
export function heartbeatSilence(root: AbsolutePath, now: number = Date.now()): number | null {
  try {
    const daemon = inStore(
      root,
      (store) => store.worktrees.get(worktreeIdFor(root))?.daemon,
      HEARTBEAT_BUSY_MS,
    );
    return daemon === undefined || daemon === null ? null : heartbeatLateBy(daemon, now);
  } catch {
    return null;
  }
}

/**
 * What held the request at the daemon's last answer, with how long each
 * fact has held; `silentMs` is `heartbeatSilence`'s. A daemon before row
 * 011-302 sends no `holder`.
 */
export function holderText(holder: RunGroupResponse["holder"], silentMs: number | null): string {
  const main: string[] = [];
  if (silentMs !== null) main.push(`has sent no heartbeat for ${age(silentMs)}`);
  if (holder?.kind === "unanswered")
    main.push(`has not read the request for ${age(holder.heldMs)}`);
  if (holder?.step) main.push(`has been ${holder.step.operation} for ${age(holder.step.heldMs)}`);
  const parts = main.length === 0 ? [] : [`the daemon's main thread ${andList(main)}`];
  const held = holder === undefined || holder === null ? null : heldText(holder);
  if (held !== null) parts.push(held);
  if (parts.length > 0) return parts.join("; ");
  return holder === undefined
    ? "this daemon does not say what holds it"
    : "what holds it is unknown";
}

/** The holder the main thread reported, `null` when it reported none. */
function heldText(holder: GroupHolder): string | null {
  switch (holder.kind) {
    case "startup":
      return `it waits for the daemon's startup, which has run for ${age(holder.heldMs)}`;
    case "scheduler":
      return holder.operation === null
        ? `it waits for the scheduler, which has been busy for ${age(holder.heldMs)} with work it does not name`
        : `it waits for the scheduler, which has been ${holder.operation} for ${age(holder.heldMs)}`;
    case "unanswered":
    case "unknown":
      return null;
  }
}

/** Floor: 48.9 s held is not yet 49 s. */
const age = (ms: number) => durationText(ms, Math.floor);

/** `a`, `a and b`, `a, b and c`. */
function andList(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * The words after "has no verdict: " for request `answer` whose deadline
 * passed in worktree `root`; `yourself` is the action that needs no daemon.
 */
export function deadlineText(
  root: AbsolutePath,
  answer: RunGroupResponse,
  yourself: string | null,
): string {
  const again = `wait again with squeal run ${shellWord(answer.group)} --wait`;
  const next = yourself === null ? again : `${again}, or ${yourself}`;
  const held = holderText(answer.holder, heartbeatSilence(root));
  return `the deadline passed before the daemon took request ${answer.requestId}; ${held}. The request stays pending: ${next}.`;
}
