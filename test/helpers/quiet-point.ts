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
  #ends: (() => void)[] = [];

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

  /** Runs open: a run is never abandoned, so a quiet point always waits for one. */
  get runs(): number {
    return this.#open.get("run") ?? 0;
  }

  /** Resolves at the next call's end. */
  nextEnd(): Promise<void> {
    return new Promise((resolve) => this.#ends.push(resolve));
  }

  /** Counts `result` open until it settles; returns it as it is. */
  track<T>(name: string, result: Promise<T>): Promise<T> {
    this.#started += 1;
    this.#open.set(name, (this.#open.get(name) ?? 0) + 1);
    const end = () => {
      this.#ended += 1;
      this.#open.set(name, (this.#open.get(name) ?? 1) - 1);
      for (const resolve of this.#ends.splice(0)) resolve();
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

/** How often a quiet point on the host's clock looks again while a wake it waits through is left. */
const THROUGH_POLL_MS = 20;

export interface QuietOptions {
  /**
   * On the host's clock, wakes it also waits through in real time, as
   * `Scheduler.idle()` did: a claim recheck while queued files wait on
   * another worktree (`"claims"`), the pump's own wait (`"pump"`). A
   * record's gather (`"slot-gather"`) is always waited through. On a
   * virtual clock no such wake fires unless the test moves time.
   */
  readonly through?: readonly string[];
  /** Default `QUIET_LIMIT_MS`. */
  readonly limitMs?: number;
}

/**
 * Row 011-378: the quiet point of `side`. It rests; while a runner call is
 * open (`waitedCalls`) it waits for a call to end and rests again; it
 * returns the rest once none is open and no call started or ended from
 * before the rest to one real timer turn after it. A record's gather is bookkeeping: on a
 * virtual clock time moves to the first gather no other wake comes at or
 * before (`gatherAt`, as `settle` does), and on the host's clock the quiet
 * point waits for it. Any other wake fires only when the test moves time,
 * or, on the host's clock, in real time when `options.through` names it.
 * A call the test holds open (a held run) holds the quiet point until it
 * ends: such a test reads `rest()` instead, or `settle` for catch-up sides.
 */
export async function quiet(side: QuietSide, options: QuietOptions = {}): Promise<Rest> {
  const limitMs = options.limitMs ?? QUIET_LIMIT_MS;
  const through = new Set(["slot-gather", ...(options.through ?? [])]);
  const limit = performance.now() + limitMs;
  const late = (what: string) =>
    new Error(`no quiet point in ${limitMs} ms: ${what}; open calls: ${side.calls.describe()}`);
  for (;;) {
    const before = side.calls.mark();
    const rest = await within(side.rest(), limit, () => late("no rest"));
    if (waitedCalls(side.calls, rest) > 0) {
      await within(side.calls.nextEnd(), limit, () => late("a runner call stayed open"));
      continue;
    }
    const at = side.clock === null ? null : gatherAt(rest);
    if (side.clock !== null && at !== null) {
      side.clock.advance(Math.max(0, at - side.clock.now()));
      continue;
    }
    const waits = side.clock === null && rest.wakes.some((wake) => through.has(wake.reason));
    await turn(waits ? THROUGH_POLL_MS : 1);
    if (!waits && waitedCalls(side.calls, rest) === 0 && side.calls.mark() === before) return rest;
    if (performance.now() > limit) {
      const left = rest.wakes.map((wake) => wake.reason).join(", ");
      throw late(waits ? `wakes left: ${left}` : "runner calls kept starting");
    }
  }
}

/**
 * The open calls a quiet point waits for: every run, and the runner part's
 * calls while the scheduler still waits for one (a `runner-part-bound`
 * wake is armed for each, `RunnerPartBound`). A runner-part call open with
 * no such wake left is past its bound: the scheduler abandoned it, as
 * `Scheduler.idle()` did, and a test may hold it open for good.
 */
function waitedCalls(calls: RunnerCalls, rest: Rest): number {
  const bounded = rest.wakes.some((wake) => wake.reason === "runner-part-bound");
  return bounded ? calls.open : calls.runs;
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
