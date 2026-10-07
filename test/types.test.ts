import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../src/core/types/index.js";

describe("core types", () => {
  it("exposes the policy defaults from spec 001 D11", () => {
    expect(DEFAULT_POLICY).toEqual({
      interrupt: { onRegression: true },
      stop: { blockOnKnownFailures: false, requireFullSuite: false, waitMs: 0 },
      baseline: { onStart: "lookup-then-run-missing" },
      inputs: [],
      env: { allowlist: [] },
      runner: { tierSize: 4, timeoutMs: 600_000 },
      nodeTest: [],
      daemon: { idleExitMinutes: 60 },
      store: { retentionDays: 7, maxSizeMb: null },
    });
  });
});
