import { describe, expect, it } from "vitest";
import { stopSlowWaitMs } from "../../src/core/slow/index.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import {
  HARNESSES,
  landSlow,
  listenAsDaemon,
  repo,
  slowKey,
  stopThenWait,
  turnOf,
} from "./stop-slow-helpers.js";

/*
 * Spec 019 D4 steps 1 and 2 (row 019-09): before it waits, the waiting Stop
 * entry sends the daemon the `run-slow` request `squeal run --slow` sends, so
 * a slow file no trigger would run (`stop-wait.md` C4) runs; and its wait may
 * reach 59 minutes. The daemon here is a front desk whose scheduler lands the
 * slow file's run as the slow tier stores it; `stop-slow-scheduler.test.ts`
 * runs the same Stop against the real scheduler.
 */

describe.each(HARNESSES)(
  "Stop asks the daemon to run its slow files, $name (019 D4.1)",
  (harness) => {
    it("runs a slow file not run and not queued, and ends the turn silently once it passes", async () => {
      const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 30_000 });
      // A `lookup-only` miss: keyed, not queued, never run. Nothing else would run it.
      slowKey(r, null);
      let asked = 0;
      await listenAsDaemon(r.store, r.worktreeId, {
        requestSlowSuite: async () => {
          asked++;
          slowKey(r, "queued");
          setTimeout(() => landSlow(r, "pass"), 100);
          return { revision: 1, queued: 1 };
        },
      });
      const started = performance.now();
      const out = await stopThenWait(harness, r);
      expect(out).toEqual({ quick: {}, waiting: {} });
      expect(asked).toBe(1);
      expect(turnOf(r)).toBe("idle");
      // It ended on the result, not at its 30 s bound.
      expect(performance.now() - started).toBeLessThan(20_000);
    });

    it("asks nothing when every slow file is current", async () => {
      const r = await repo(harness, { requireSlowSuite: true });
      landSlow(r, "pass");
      let asked = 0;
      await listenAsDaemon(r.store, r.worktreeId, {
        requestSlowSuite: async () => {
          asked++;
          return { revision: 1, queued: 0 };
        },
      });
      expect(await stopThenWait(harness, r)).toEqual({ quick: {}, waiting: {} });
      expect(asked).toBe(0);
    });
  },
);

describe("the bound of Stop's slow wait (019 D4.2)", () => {
  const policy = (slowWaitMs: number) => ({
    ...DEFAULT_POLICY,
    stop: { ...DEFAULT_POLICY.stop, requireSlowSuite: true, slowWaitMs },
  });

  it("honours a stop.slowWaitMs past the old 10 minutes, up to 59", () => {
    expect(stopSlowWaitMs(policy(1_800_000))).toBe(1_800_000);
    expect(stopSlowWaitMs(policy(3_540_000))).toBe(3_540_000);
    expect(stopSlowWaitMs(policy(7_200_000))).toBe(3_540_000);
    expect(stopSlowWaitMs(DEFAULT_POLICY)).toBeNull();
  });
});
