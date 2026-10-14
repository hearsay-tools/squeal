import { describe, expect, it } from "vitest";
import type { SerializedError } from "vitest/node";
import { formatDelta, MESSAGE_CAP_CHARS } from "../../src/core/delivery/index.js";
import { describeFailure, SUMMARY_MAX_CHARS } from "../../src/core/state/index.js";
import type { CheckError, Delta, TransitionEntry } from "../../src/core/types/index.js";
import { WorktreePaths } from "../../src/runners/vitest/paths.js";
import {
  CAUSE_DEPTH,
  CAUSE_MESSAGE_CHARS,
  toCheckError,
} from "../../src/runners/vitest/results.js";

const ROOT = "/work/tree";

function error(message: string, overrides: Partial<CheckError> = {}): CheckError {
  return { name: "TypeError", message, stack: null, location: null, diff: null, ...overrides };
}

const refused = { message: "connect ECONNREFUSED 127.0.0.1:3000", code: "ECONNREFUSED" };

/** Task 001-361, research environment-failures Q1. */
describe("a stored error keeps its code and cause (task 001-361)", () => {
  it("maps Vitest's code and cause chain, bounded by depth and length, codes whole", () => {
    const long = "x".repeat(500);
    const mapped = toCheckError(
      {
        name: "TypeError",
        message: "fetch failed",
        code: "UND_ERR",
        cause: {
          message: `${long}\nsecond line`,
          code: "E_LONG_CODE_KEPT_WHOLE_".repeat(4),
          cause: {
            message: `connect ECONNREFUSED ${ROOT}/sock`,
            code: "ECONNREFUSED",
            cause: { message: "third", cause: { message: "fourth, past the depth" } },
          },
        },
      },
      new WorktreePaths(ROOT),
    );
    expect(mapped.code).toBe("UND_ERR");
    expect(mapped.causes).toHaveLength(CAUSE_DEPTH);
    expect(mapped.causes?.[0]?.message).toHaveLength(CAUSE_MESSAGE_CHARS);
    expect(mapped.causes?.[0]?.code).toBe("E_LONG_CODE_KEPT_WHOLE_".repeat(4));
    expect(mapped.causes?.[1]).toEqual({
      message: "connect ECONNREFUSED sock",
      code: "ECONNREFUSED",
    });
    expect(mapped.causes?.[2]).toEqual({ message: "third" });
  });

  it("adds no field to an error with neither code nor cause", () => {
    const mapped = toCheckError({ name: "Error", message: "boom" }, new WorktreePaths(ROOT));
    expect(Object.keys(mapped).sort()).toEqual(["diff", "location", "message", "name", "stack"]);
  });

  it("keeps a cause that is not an error as its text", () => {
    // Vitest types `cause` as an error; a thrown value may be anything.
    const thrown = { message: "wrapped", cause: "disk full" } as unknown as SerializedError;
    const mapped = toCheckError(thrown, new WorktreePaths(ROOT));
    expect(mapped.causes).toEqual([{ message: "disk full" }]);
  });

  it("names the cause in the summary, and the code when the text does not", () => {
    expect(describeFailure([error("fetch failed", { causes: [refused] })], null).summary).toBe(
      "fetch failed; cause: connect ECONNREFUSED 127.0.0.1:3000",
    );
    expect(
      describeFailure(
        [error("fetch failed", { causes: [{ message: "", code: "ENOTFOUND" }] })],
        null,
      ).summary,
    ).toBe("fetch failed; cause: ENOTFOUND");
    expect(
      describeFailure(
        [error("Cannot find module './gone.js'", { code: "ERR_MODULE_NOT_FOUND" })],
        null,
      ).summary,
    ).toBe("Cannot find module './gone.js' (ERR_MODULE_NOT_FOUND)");
  });

  it("words a setup error as setup failed, and a load error as it is", () => {
    const hook = error("fetch failed", { causes: [refused], phase: "setup" });
    expect(describeFailure([hook], null).summary).toBe(
      "setup failed: fetch failed; cause: connect ECONNREFUSED 127.0.0.1:3000",
    );
    expect(describeFailure([error("boom", { phase: "load" })], null).summary).toBe("boom");
  });

  it("keeps the cause's code within the cap when the first line is long", () => {
    const { summary } = describeFailure(
      [error("y".repeat(1000), { causes: [refused, refused, refused] })],
      null,
    );
    expect(summary.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
    expect(summary).toContain("; cause: connect ECONNREFUSED 127.0.0.1:3000");
  });

  it("keeps a delivery of many setup failures with long causes within its cap", () => {
    const long = { message: `connect ECONNREFUSED ${"z".repeat(300)}`, code: "ECONNREFUSED" };
    const { summary } = describeFailure(
      [error("fetch failed", { causes: [long, long, long], phase: "setup" })],
      null,
    );
    const entries = Array.from(
      { length: 40 },
      (_, i): TransitionEntry => ({
        kind: "first-seen-fail",
        check: { kind: "file", project: "", testPath: `e2e/f${i}.e2e.ts` },
        from: null,
        to: "fail",
        validity: "current",
        observedAt: 3,
        origin: { kind: "own" },
        summary,
        location: null,
      }),
    );
    const delta: Delta = {
      schemaVersion: 1,
      consumer: { worktreeId: "wt", sessionId: "s", agentId: "main" },
      header: {
        revision: 3,
        counts: { current: 40, pending: 0, stale: 0, unknown: 0 },
        testFilesWithoutChecks: { pending: 0, unknown: 0 },
        fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
      },
      label: "transitions",
      entries,
    };
    const text = formatDelta(delta);
    expect(text.length).toBeLessThanOrEqual(MESSAGE_CAP_CHARS);
    expect(text).toContain("setup failed: fetch failed; cause: connect ECONNREFUSED");
  });

  it("leaves the fingerprint alone, so a stored failure does not read as changed", () => {
    const plain = describeFailure([error("fetch failed")], null).fingerprint;
    const rich = describeFailure(
      [error("fetch failed", { causes: [refused], code: "UND_ERR", phase: "setup" })],
      null,
    ).fingerprint;
    expect(rich).toBe(plain);
  });
});
