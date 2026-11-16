import { setTimeout as delay } from "node:timers/promises";
import type { Rest, Scheduler } from "../../src/core/types/scheduler.js";

/*
 * Row 011-367: a scheduler on a virtual clock whose runner works in real
 * time (a real Vitest, node:test or a fixture's runs). `rest` sets the
 * runner's work aside, a runner-part call included; these wait for that
 * work in real time and move the clock only to the wakes they are told.
 */

/** What a harness on the virtual clock offers (`vitest-harness.ts`, `catch-up-fixture.ts`, `claims-fixture.ts`). */
export interface Driven {
  readonly scheduler: Pick<Scheduler, "idle">;
  now(): number;
  advance(ms: number): void;
  rest(): Promise<Rest>;
}

/** The wakes `until` moves the clock to by default: a backlog record's gather and the pump's own wait. */
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
 * No other wake (a yield bound, a pool recheck) is passed. The caller
 * asserts `done` after.
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

/** `Scheduler.idle` on the virtual clock: `until` it resolves. Throws when it did not. */
export async function idleOn(side: Driven): Promise<void> {
  let idle = false;
  void side.scheduler.idle().then(() => {
    idle = true;
  });
  await until(side, () => idle);
  if (!idle) throw new Error("the scheduler did not come to idle on the virtual clock");
}
