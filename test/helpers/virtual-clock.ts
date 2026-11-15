import type { Clock, Disarm } from "../../src/core/scheduler/clock.js";
import type { EpochMs } from "../../src/core/types/common.js";

/*
 * Row 011-351 (card 7, `research/scheduler-step.md`, "The clock port"): the
 * clock port's virtual adapter. Time moves only on `advance`; a timer fires
 * when time reaches it, timers due together in the order they were armed.
 */

interface Armed {
  readonly at: EpochMs;
  readonly seq: number;
  readonly fire: () => void;
}

export interface VirtualClock extends Clock {
  /** Moves time `ms` forward (at least 0), firing each timer due on the way, at its own time. */
  advance(ms: number): void;
  /** How many timers are armed and not yet fired. */
  readonly armed: number;
}

/** A virtual clock that starts at `start`. */
export function virtualClock(start: EpochMs = 0): VirtualClock {
  let now = start;
  let seq = 0;
  const timers: Armed[] = [];
  const next = (until: EpochMs): Armed | undefined => {
    let first: Armed | undefined;
    for (const t of timers) {
      if (t.at > until) continue;
      if (first === undefined || t.at < first.at || (t.at === first.at && t.seq < first.seq))
        first = t;
    }
    return first;
  };
  return {
    now: () => now,
    arm(ms: number, fire: () => void): Disarm {
      const timer = { at: now + Math.max(0, ms), seq: seq++, fire };
      timers.push(timer);
      return () => {
        const at = timers.indexOf(timer);
        if (at >= 0) timers.splice(at, 1);
      };
    },
    advance(ms: number): void {
      const until = now + Math.max(0, ms);
      for (let due = next(until); due !== undefined; due = next(until)) {
        timers.splice(timers.indexOf(due), 1);
        now = due.at;
        due.fire();
      }
      now = until;
    },
    get armed() {
      return timers.length;
    },
  };
}
