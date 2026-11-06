import { durationText, shellWord } from "../core/text.js";
import type { RunGroupResponse } from "../core/types/index.js";

/*
 * Row 011-302 (gh-154): what `squeal run <group> --wait` says when its
 * deadline passed before the daemon took the request. It names what held
 * the request as the daemon recorded it, never a guess, and the next action;
 * the request stays pending and the wait gives no verdict (exit 3).
 */

/**
 * What held the request at the daemon's last answer: its startup, the
 * scheduler's lock with the operation that holds it and how long, or that
 * it is unknown. A daemon before row 011-302 sends no `holder`.
 */
export function holderText(holder: RunGroupResponse["holder"]): string {
  if (holder === undefined) return "this daemon does not say what holds it";
  if (holder === null) return "what holds it is unknown";
  // Floor: 48.9 s held is not yet 49 s.
  const held = durationText(holder.heldMs, Math.floor);
  if (holder.kind === "startup") {
    return `it waits for the daemon's startup, which has run for ${held}`;
  }
  if (holder.operation === null) {
    return `it waits for the scheduler, which has been busy for ${held} with work it does not name`;
  }
  return `it waits for the scheduler, which has been ${holder.operation} for ${held}`;
}

/**
 * The words after "has no verdict: " for request `answer` of group `group`
 * whose deadline passed; `yourself` is the action that needs no daemon.
 */
export function deadlineText(answer: RunGroupResponse, yourself: string | null): string {
  const again = `wait again with squeal run ${shellWord(answer.group)} --wait`;
  const next = yourself === null ? again : `${again}, or ${yourself}`;
  return `the deadline passed before the daemon took request ${answer.requestId}; ${holderText(answer.holder)}. The request stays pending: ${next}.`;
}
