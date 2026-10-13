import { describe, expect, it } from "vitest";
import { writeTurn } from "../../src/core/delivery/turn.js";
import {
  STOP_SLOW_HANDOFF_MS,
  STOP_SLOW_HANDOFF_SLACK_MS,
} from "../../src/harness/shared/stop-slow.js";
import type { SquealRepo } from "./helpers.js";
import {
  clock,
  decision,
  deps,
  HARNESSES,
  landSlow,
  mainConsumer,
  repo,
  stopThenWait,
  turnOf,
} from "./stop-slow-helpers.js";

/*
 * Task 001-326: the waiting Stop entry takes the 2 s entry's handoff as
 * fresh from `STOP_SLOW_HANDOFF_SLACK_MS` before its own process started,
 * not before it reached the check. Under load its Node start, policy read
 * and store open can take longer than the whole 2 s entry; the handoff
 * still counts. A handoff from before that, a previous turn's, does not.
 */

/** A day, the injected clocks' offsets from the real one. */
const DAY_MS = 86_400_000;

/** The 2 s entry's silent end: the consumer idle with a handoff stamped `at`. */
function handOff(r: SquealRepo, at: number): void {
  r.store.transaction(() =>
    writeTurn(r.store, mainConsumer(r), {
      turn: "idle",
      testFiles: [],
      newTestFiles: false,
      handoff: { at },
    }),
  );
}

/** Blocks the thread `ms`, as a loaded host stalls the entry before its check. */
function stall(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

describe.each(HARNESSES)("the waiting Stop's handoff, $name (001-326)", (harness) => {
  it("a slow start past the 2 s entry's whole run still takes its handoff and blocks", {
    timeout: 15_000,
  }, async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
    const late = clock({ 1: () => stall(STOP_SLOW_HANDOFF_SLACK_MS + 100) });
    const out = await stopThenWait(harness, r, () => landSlow(r, "fail"), late);
    expect(out.quick).toEqual({});
    expect(out.waiting.decision).toBe("block");
    expect(out.waiting.reason).toMatch(
      /ran at revision 1: 1 check fails: test\/e2e\/slow\.test\.ts/,
    );
    expect(turnOf(r)).toBe("in-turn");
  });

  it("a handoff from before this process started is a previous turn's: it waits and stays silent", {
    timeout: 15_000,
  }, async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
    handOff(r, performance.timeOrigin - STOP_SLOW_HANDOFF_SLACK_MS - 1_000);
    landSlow(r, "fail");
    const started = performance.now();
    expect(decision(await harness.stopSlow(r))).toEqual({});
    expect(performance.now() - started).toBeGreaterThanOrEqual(STOP_SLOW_HANDOFF_MS - 50);
    expect(turnOf(r)).toBe("idle");
  });
});

/*
 * Review wave 13bc S2 (task 001-332): `HookDeps.now` advances with real time
 * at a constant offset, and the handoff is stamped in its frame. Behind, a
 * cutoff in the real frame would take the fresh handoff as stale; ahead, it
 * would take the stale one as fresh. Only the waiting entry runs on it: the
 * daemon's activity is stamped in the real frame.
 */
describe.each(
  HARNESSES.flatMap((harness) => [-DAY_MS, DAY_MS].map((offset) => ({ harness, offset }))),
)(
  "the waiting Stop's handoff on a clock $offset ms off, $harness.name (001-332)",
  ({ harness, offset }) => {
    const shifted = { ...deps, now: () => Date.now() + offset };

    it("a handoff stamped now in that frame is fresh: it blocks", {
      timeout: 15_000,
    }, async () => {
      const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
      handOff(r, shifted.now());
      landSlow(r, "fail");
      const out = decision(await harness.stopSlow(r, {}, shifted));
      expect(out.decision).toBe("block");
      expect(out.reason).toMatch(/ran at revision 1: 1 check fails: test\/e2e\/slow\.test\.ts/);
      expect(turnOf(r)).toBe("in-turn");
    });

    it("a handoff from before this process started, in that frame, stays stale", {
      timeout: 15_000,
    }, async () => {
      const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
      handOff(r, performance.timeOrigin + offset - STOP_SLOW_HANDOFF_SLACK_MS - 1_000);
      landSlow(r, "fail");
      const started = performance.now();
      expect(decision(await harness.stopSlow(r, {}, shifted))).toEqual({});
      expect(performance.now() - started).toBeGreaterThanOrEqual(STOP_SLOW_HANDOFF_MS - 50);
      expect(turnOf(r)).toBe("idle");
    });
  },
);
