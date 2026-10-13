import { describe, expect, it } from "vitest";
import { writeTurn } from "../../src/core/delivery/turn.js";
import {
  STOP_SLOW_HANDOFF_MS,
  STOP_SLOW_HANDOFF_SLACK_MS,
} from "../../src/harness/shared/stop-slow.js";
import {
  clock,
  decision,
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
    const at = performance.timeOrigin - STOP_SLOW_HANDOFF_SLACK_MS - 1_000;
    r.store.transaction(() =>
      writeTurn(r.store, mainConsumer(r), {
        turn: "idle",
        testFiles: [],
        newTestFiles: false,
        handoff: { at },
      }),
    );
    landSlow(r, "fail");
    const started = performance.now();
    expect(decision(await harness.stopSlow(r))).toEqual({});
    expect(performance.now() - started).toBeGreaterThanOrEqual(STOP_SLOW_HANDOFF_MS - 50);
    expect(turnOf(r)).toBe("idle");
  });
});
