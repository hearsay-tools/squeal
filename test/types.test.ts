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
        slowWaitMs: 120_000,
      },
      testCommand: { denyWhenCurrent: false },
      baseline: { onStart: "lookup-only" },
      inputs: [],
      observe: { runtimeInputs: true },
      env: { allowlist: [] },
      runner: { tierSize: 4, backlogTierSize: 200, timeoutMs: 600_000 },
      nodeTest: [],
      pytest: [],
      vitest: { excludeProjects: [], exclude: [] },
      slow: {
        include: [],
        maxWorkers: 2,
        maxLoadPerCpu: 1,
        maxDeferMs: 600_000,
        maxParallel: 4,
        rank: "tokens",
        trigger: "continuous",
        quietMs: 3_000,
      },
      delivery: { uncoveredEdits: true },
      daemon: { idleExitMinutes: 60, unusedExitMinutes: 30 },
      store: { retentionDays: 7, maxSizeMb: null },
      // Spec 015 D1.
      complexity: {
        enabled: false,
        threshold: 20,
        include: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py}"],
        exclude: ["**/dist/**", "**/build/**", "**/vendor/**", "**/*.min.js"],
        maxFileBytes: 524_288,
        blocking: false,
      },
      coverage: { enabled: false },
      crap: { threshold: 30 },
    });
  });
});
