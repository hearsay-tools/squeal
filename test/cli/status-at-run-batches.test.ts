import { describe, expect, it } from "vitest";
import { tellsEstimate } from "../../src/cli/status-at-run-batches.js";

/*
 * Row 023-19 (lessons P3): when `--run` tells its estimate. Row 023-41
 * removed the in-call run's batch sizes and stop margin, and their tests.
 */

describe("--run's estimate rule (row 023-19, P3)", () => {
  it("tells the estimate with --all-missing, over half the time left, or past one round unknown", () => {
    const estimate = { runner: "vitest", files: 30, known: 30, width: 8 } as const;
    expect(tellsEstimate({ ...estimate, seconds: 100 }, false, 300)).toBe(false);
    expect(tellsEstimate({ ...estimate, seconds: 151 }, false, 300)).toBe(true);
    expect(tellsEstimate({ ...estimate, seconds: 1 }, true, 300)).toBe(true);
    expect(tellsEstimate({ ...estimate, seconds: null, known: 0 }, false, 300)).toBe(true);
    expect(tellsEstimate({ ...estimate, seconds: null, files: 8 }, false, 300)).toBe(false);
  });
});
