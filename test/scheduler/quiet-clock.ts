import { expect } from "vitest";
import { publishedWaits } from "../../src/core/scheduler/quiet.js";
import type { Scheduler, Store, WorktreeId } from "../../src/core/types/index.js";

/*
 * Row 011-153 (spec 011 C4 step 5 as amended 2026-10-23): an edit's
 * catch-up waits 120 s for quiet. A test of what runs and in which order,
 * not of the wait, moves the scheduler's clock past it instead of idling
 * through it on the host's.
 */

/** A scheduler whose clock (`SchedulerOptions.now`) a test moves. */
export interface Clocked {
  readonly scheduler: Scheduler;
  readonly store: Store;
  readonly worktreeId: string;
  now(): number;
  /** Moves the scheduler's clock `ms` ahead. */
  advance(ms: number): void;
}

/** `base` plus what `advance` added. */
export function movableClock(base: () => number = Date.now): Pick<Clocked, "now" | "advance"> {
  let offset = 0;
  return {
    now: () => base() + offset,
    advance: (ms) => {
      offset += ms;
    },
  };
}

/** How often `idleAfterQuiet` looks whether only a wait before catch-up is left. */
const QUIET_POLL_MS = 100;

/**
 * Moves `side`'s clock past its wait before catch-up when the wait is all
 * that is left: no edit's work or promoted file queued (`inUse`). Whether
 * it moved.
 */
function skipCatchUpQuiet(side: Clocked): boolean {
  if (side.scheduler.inUse()) return false;
  const now = side.now();
  const ends = publishedWaits(side.store, side.worktreeId as WorktreeId, 0, now).catchUp;
  if (ends.size === 0) return false;
  side.advance(Math.max(...ends.values()) - now);
  return true;
}

/** Waits until `side`'s wait before catch-up is all that is left, then moves its clock past it. */
export async function pastCatchUpQuiet(side: Clocked): Promise<void> {
  const skipped = () => skipCatchUpQuiet(side);
  await expect.poll(skipped, { interval: QUIET_POLL_MS, timeout: 30_000 }).toBe(true);
}

/** `scheduler.idle()`, moving `side`'s clock past each wait before catch-up on the way. */
export async function idleAfterQuiet(side: Clocked): Promise<void> {
  let idle = false;
  const done = side.scheduler.idle().then(() => {
    idle = true;
  });
  while (!idle) {
    await Promise.race([done, new Promise((resolve) => setTimeout(resolve, QUIET_POLL_MS))]);
    if (!idle) skipCatchUpQuiet(side);
  }
}
