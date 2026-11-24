import { describe, expect, it } from "vitest";
import { testTimings } from "../../src/cli/daemon.js";
import { hostIdleMs } from "../../src/core/daemon/host-idle.js";
import { DRAIN_SLOW_WAIT_MS } from "../../src/core/daemon/lifecycle.js";
import { SLOW_RECHECK_MS } from "../../src/core/scheduler/slow-tier.js";

/*
 * Row 010-37: three test-only environment overrides shorten the waits a
 * real-daemon test would sit through. Without them the production defaults
 * hold: a drain's slow lane waits 60 s, the slow slot is looked at again
 * every 15 s, and a host's idle bound is `runner.hostIdleMinutes` whole
 * minutes.
 */

describe("squeal daemon's test timings (row 010-37)", () => {
  it("keeps the production defaults when unset", () => {
    expect(testTimings({})).toEqual({});
    expect(DRAIN_SLOW_WAIT_MS).toBe(60_000);
    expect(SLOW_RECHECK_MS).toBe(15_000);
    expect(hostIdleMs(null, () => 1, 6)()).toBe(60_000);
  });

  it("reads positive whole milliseconds", () => {
    expect(
      testTimings({
        SQUEAL_TEST_HOST_IDLE_MS: "2000",
        SQUEAL_TEST_DRAIN_SLOW_WAIT_MS: "4000",
        SQUEAL_TEST_SLOW_RECHECK_MS: "500",
      }),
    ).toEqual({ hostIdleMs: 2_000, slowRecheckMs: 500, timings: { drainSlowWaitMs: 4_000 } });
  });

  it("ignores any other value", () => {
    for (const value of ["", "0", "-5", "1.5", "2s", "1e3", "99999999999999999999"]) {
      const env = {
        SQUEAL_TEST_HOST_IDLE_MS: value,
        SQUEAL_TEST_DRAIN_SLOW_WAIT_MS: value,
        SQUEAL_TEST_SLOW_RECHECK_MS: value,
      };
      expect(testTimings(env), value).toEqual({});
    }
  });
});
