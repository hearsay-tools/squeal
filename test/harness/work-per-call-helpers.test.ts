import { describe, expect, it } from "vitest";
import type { CodeStatus } from "../../src/core/types/code-delivery.js";
import type { StatusResult } from "../../src/core/types/status.js";
import { countEnded } from "./work-per-call-helpers.js";

const code = (pending: number, files: number): CodeStatus => ({
  v: 1,
  threshold: 20,
  over: 0,
  sinceRegistration: 0,
  since: null,
  pending,
  files,
  unknown: 0,
});
const snapshot = (of?: CodeStatus) =>
  ({ available: true, ...(of === undefined ? {} : { code: of }) }) as unknown as StatusResult;

describe("countEnded (review 025-wave6 S1)", () => {
  it("waits while files are not counted yet", () => {
    expect(countEnded(snapshot(code(55, 55)), 50)).toBe(false);
    expect(countEnded(snapshot(code(1, 55)), 50)).toBe(false);
  });

  it("waits while no file is admitted, or fewer than the floor", () => {
    expect(countEnded(snapshot(code(0, 0)), 50)).toBe(false);
    expect(countEnded(snapshot(code(0, 49)), 50)).toBe(false);
  });

  it("waits while the status has no count or the daemon did not answer", () => {
    expect(countEnded(snapshot(), 50)).toBe(false);
    const unavailable = { available: false, reason: "timeout" } as unknown as StatusResult;
    expect(countEnded(unavailable, 50)).toBe(false);
  });

  it("ends once every admitted file is counted", () => {
    expect(countEnded(snapshot(code(0, 55)), 50)).toBe(true);
  });
});
