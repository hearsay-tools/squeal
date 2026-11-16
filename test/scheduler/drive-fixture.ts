import { setTimeout as delay } from "node:timers/promises";
import type { Rest } from "../../src/core/types/scheduler.js";
import type { QuietOptions } from "../helpers/quiet-point.js";

/*
 * Row 011-367: a scheduler on a virtual clock whose runner works in real
 * time (a real Vitest, node:test or a fixture's runs). `rest` sets the
 * runner's work aside, a runner-part call included; these wait for that
 * work in real time and move the clock only to the wakes they are told.
 */

/** What a harness on the virtual clock offers (`vitest-harness.ts`, `catch-up-fixture.ts`, `claims-fixture.ts`). */
export interface Driven {
  now(): number;
  advance(ms: number): void;
  rest(): Promise<Rest>;
  /** Row 011-378: the quiet point (`quiet-point.ts`): a rest with no runner call open. */
  quiet(options?: QuietOptions): Promise<Rest>;
}

/**
 * The wakes `until` moves the clock to by default: a backlog record's
 * gather and the pump's own wait, a pool's capacity recheck included (a
 * refused grant waits as a pump wake; review `reviews/011-363-367.md` N1).
 */
export const DRIVEN: readonly string[] = ["slot-gather", "pump"];

/** Rests once no runner-part call is open: those are the runner's real work. */
export async function settle(side: Driven): Promise<Rest> {
  for (;;) {
    const rest = await side.rest();
    if (!rest.wakes.some((wake) => wake.reason === "runner-part-bound")) return rest;
    await delay(10);
  }
}

/**
 * Until `done`, at most `steps` rests: at each, the clock moves to the next
 * wake if `driven` names it, else the runner's real work goes on for 10 ms.
 * No other wake (a yield bound, a claim recheck) is passed. A test that
 * must stay before a pool's recheck moves the clock itself or leaves
 * `pump` out of `driven`. The caller asserts `done` after.
 */
export async function until(
  side: Driven,
  done: () => boolean,
  { steps = 3_000, driven = DRIVEN }: { steps?: number; driven?: readonly string[] } = {},
): Promise<void> {
  for (let i = 0; i < steps && !done(); i++) {
    const rest = await settle(side);
    if (done()) return;
    if (rest.next !== null && driven.includes(rest.next.reason))
      side.advance(Math.max(0, rest.next.at - side.now()));
    else await delay(10);
  }
}

/**
 * Row 011-378: the scheduler idle on the virtual clock: at its quiet point
 * (`quiet-point.ts`) with no wake `DRIVEN` names left; the clock moves to
 * each such wake on the way, as `until` moves it. A wake no driven reason
 * names (a yield bound, a claim recheck) stays for the test to move.
 * Returns that rest; throws when the driven wakes never end.
 */
export async function idleOn(side: Driven, steps = 3_000): Promise<Rest> {
  for (let i = 0; i < steps; i++) {
    const rest = await side.quiet();
    const { next } = rest;
    if (next === null || !DRIVEN.includes(next.reason)) return rest;
    side.advance(Math.max(0, next.at - side.now()));
  }
  throw new Error("the scheduler did not come to idle on the virtual clock");
}
