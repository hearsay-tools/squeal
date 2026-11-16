import type { Rest } from "../../src/core/types/scheduler.js";
import { DRIVEN, type Driven } from "./drive-fixture.js";

/*
 * Row 011-381 C2: slow-lane files on the virtual clock. `Scheduler.idle()`
 * waited for a slow lane's looks (its slot, trigger or load guard) in real
 * time; on the virtual clock the test moves the clock to them.
 */

/** `DRIVEN` and the slow lane's looks (`slow-lane`). */
export const SLOW_DRIVEN: readonly string[] = [...DRIVEN, "slow-lane"];

/**
 * The quiet point (`quiet-point.ts`) with no wake `driven` names next; the
 * clock moves to each such wake on the way, as `idleOn` moves it to
 * `DRIVEN`'s. Returns that rest; throws when the driven wakes never end.
 */
export async function idleSlow(
  side: Driven,
  driven: readonly string[] = SLOW_DRIVEN,
  steps = 3_000,
): Promise<Rest> {
  for (let i = 0; i < steps; i++) {
    const rest = await side.quiet();
    const { next } = rest;
    if (next === null || !driven.includes(next.reason)) return rest;
    side.advance(Math.max(0, next.at - side.now()));
  }
  throw new Error("the scheduler did not come to rest on the virtual clock");
}

/**
 * Ten of the slow lane's looks (`recheckMs` 50) on the virtual clock, each
 * with a rest: what a real-time pause gave them. A held run stays in
 * flight, so this is no quiet point.
 */
export async function looks(side: Driven, recheckMs = 50, times = 10): Promise<void> {
  for (let i = 0; i < times; i++) {
    side.advance(recheckMs);
    await side.rest();
  }
}
