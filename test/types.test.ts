import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../src/core/types/index.js";

describe("core types", () => {
  it("exposes the policy defaults from spec 001 D11", () => {
    expect(DEFAULT_POLICY).toEqual({
      interrupt: { onRegression: true },
      stop: {
        blockOnKnownFailures: false,
        requireFullSuite: false,
        waitMs: 0,
        requireSlowSuite: false,
      },
      baseline: { onStart: "lookup-then-run-missing" },
      inputs: [],
      observe: { runtimeInputs: true },
      env: { allowlist: [] },
      runner: { tierSize: 4, backlogTierSize: 200, timeoutMs: 600_000 },
      nodeTest: [],
      slow: { include: [], maxWorkers: 2, maxLoadPerCpu: 1, maxDeferMs: 600_000, maxParallel: 4 },
      daemon: { idleExitMinutes: 60 },
      store: { retentionDays: 7, maxSizeMb: null },
    });
  });
});
