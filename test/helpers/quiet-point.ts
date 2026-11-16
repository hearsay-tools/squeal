import { setTimeout as turn } from "node:timers/promises";
import type { RunnerAdapter } from "../../src/core/types/runner.js";
import type { Rest } from "../../src/core/types/scheduler.js";
import type { VirtualClock } from "./virtual-clock.js";

/*
 * Row 011-378 (row 011-371's survey, "Row H", option 1): a test's quiet
 * point. `Scheduler.rest()` sets a runner's work aside (`GLOSSARY.md`,
 * "Rest"): a run or a runner-part call can still be open when it returns.
 * A scheduler builder hands `createScheduler` its runner through
 * `countCalls`, and `quiet` waits for both: the scheduler rests and no
 * runner call is open. Test-only; no `src/` change.
 */

/** The runner's calls a quiet point waits for: every call the scheduler makes but `close`. */
const COUNTED = [
  "run",
  "affected",
  "closure",
  "enumerate",
  "environment",
  "invalidate",
  "recheck",
  "testFiles",
  "globalSetups",
  "releaseLane",
] as const;

/** The runner calls the scheduler has open, and a mark that any call's start or end changes. */
export class RunnerCalls {
  #started = 0;
  #ended = 0;
  readonly #open = new Map<string, number>();
  #drained: (() => void)[] = [];

  /** Calls started and not yet ended. */
  get open(): number {
    return this.#started - this.#ended;
  }

  /** Changes at each call's start and at each call's end. */
  mark(): string {
    return `${this.#started}/${this.#ended}`;
  }

  /** The open calls by name, as `run ×2, closure ×1`; `none` when none is. */
  describe(): string {
    const open = [...this.#open].filter(([, n]) => n > 0).map(([name, n]) => `${name} ×${n}`);
    return open.length === 0 ? "none" : open.join(", ");
  }

  /** Resolves once no call is open: at once when none is. */
  drained(): Promise<void> {
    if (this.open === 0) return Promise.resolve();
    return new Promise((resolve) => this.#drained.push(resolve));
  }

  /** Counts `result` open until it settles; returns it as it is. */
  track<T>(name: string, result: Promise<T>): Promise<T> {
    this.#started += 1;
    this.#open.set(name, (this.#open.get(name) ?? 0) + 1);
    const end = () => {
      this.#ended += 1;
      this.#open.set(name, (this.#open.get(name) ?? 1) - 1);
      if (this.open === 0) for (const resolve of this.#drained.splice(0)) resolve();
    };
    // The caller gets `result` itself, so its rejection reaches the caller and no one else.
    result.then(end, end);
    return result;
  }
}

/**
 * `runner` with each counted call through `calls`. It reads the call from
 * `runner` at each call, so a test that replaces `runner.run` (or a part's
 * call) after the build is still counted; a call `runner` lacks stays
 * `undefined`. Every other member is `runner`'s own.
 */
export function countCalls(runner: RunnerAdapter, calls: RunnerCalls): RunnerAdapter {
  const counted: PropertyDescriptorMap = {};
  for (const name of COUNTED) {
    counted[name] = {
      get() {
        const call = (runner as unknown as Record<string, unknown>)[name];
        if (typeof call !== "function") return call;
        return (...args: unknown[]) =>
          calls.track(name, Promise.resolve(call.apply(runner, args) as unknown));
      },
    };
  }
  return Object.create(runner, counted) as RunnerAdapter;
}

/** What `quiet` reads of a scheduler builder. */
export interface QuietSide {
  /** On a virtual clock, fires the timers due, then `Scheduler.rest()`. */
  rest(): Promise<Rest>;
  readonly calls: RunnerCalls;
  /** The scheduler's virtual clock; `null` on the host's. */
  readonly clock: VirtualClock | null;
}

/** A quiet point not found in this long fails the test: a guard on the host's clock only. */
export const QUIET_LIMIT_MS = 120_000;

/**
 * Row 011-378: the quiet point of `side`. It rests; while a runner call is
 * open it waits for the calls to end and rests again; it returns the rest
 * once no call is open and no call started or ended from before the rest
 * to one real timer turn after it. On a virtual clock it moves time only
 * to a record's gather that no other wake comes at or before (`gatherAt`,
 * as `settle` does); any other wake fires only when the test moves time.
 * A call the test holds open (a held run) holds the quiet point until it
 * ends: such a test reads `rest()` instead, or `settle` for catch-up sides.
 */
export async function quiet(side: QuietSide, limitMs = QUIET_LIMIT_MS): Promise<Rest> {
  const limit = performance.now() + limitMs;
  const late = (what: string) =>
    new Error(`no quiet point in ${limitMs} ms: ${what}; open calls: ${side.calls.describe()}`);
  for (;;) {
    const before = side.calls.mark();
    const rest = await within(side.rest(), limit, () => late("no rest"));
    if (side.calls.open > 0) {
      await within(side.calls.drained(), limit, () => late("a runner call stayed open"));
      continue;
    }
    const at = side.clock === null ? null : gatherAt(rest);
    if (side.clock !== null && at !== null) {
      side.clock.advance(Math.max(0, at - side.clock.now()));
      continue;
    }
    await turn(1);
    if (side.calls.open === 0 && side.calls.mark() === before) return rest;
    if (performance.now() > limit) throw late("runner calls kept starting");
  }
}

/**
 * The first gather of `rest` that no other wake comes at or before (review
 * `reviews/011-363-367.md` S1): moving the clock to it fires nothing but
 * gathers. `null` when there is none.
 */
export function gatherAt(rest: Rest | undefined): number | null {
  const wakes = rest?.wakes ?? [];
  const other = Math.min(
    ...wakes.filter((wake) => wake.reason !== "slot-gather").map((wake) => wake.at),
  );
  const gathers = wakes
    .filter((wake) => wake.reason === "slot-gather" && wake.at < other)
    .map((wake) => wake.at);
  return gathers.length > 0 ? Math.min(...gathers) : null;
}

/** `promise`, or `fail()`'s error once the host's clock passes `limit`. */
async function within<T>(promise: Promise<T>, limit: number, fail: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(fail()), Math.max(0, limit - performance.now()));
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}
