import { describe, expect, it } from "vitest";
import type { CheckId, Validity } from "../../src/core/types/index.js";
import { knownFailuresLine } from "../../src/harness/shared/text.js";

/*
 * Task 001-222: a Stop's `Known failures: N` names them, or the first few and
 * then where the rest are listed. Task 011-15 (spec 011 C6 as amended, gh-34):
 * only current failures are counted and named; pending and stale ones get
 * status's `Earlier failures` line.
 */

const check = (name: string): CheckId => ({
  kind: "test",
  project: "",
  testPath: "src/math.test.ts",
  fullName: `math > ${name}`,
});

const failure = (name: string, validity: Validity = "current") => ({
  check: check(name),
  validity,
});

describe("knownFailuresLine", () => {
  it("is the bare count with none", () => {
    expect(knownFailuresLine([])).toBe("Known failures: 0");
  });

  it("names every failure up to five", () => {
    expect(knownFailuresLine([failure("adds"), failure("subtracts")])).toBe(
      "Known failures: 2 (src/math.test.ts > math > adds, src/math.test.ts > math > subtracts)",
    );
  });

  it("names the first five and points to status for the rest", () => {
    const failures = Array.from({ length: 7 }, (_, i) => failure(`case ${i}`));
    const line = knownFailuresLine(failures, "/opt/squeal");
    expect(line).toMatch(/^Known failures: 7 \(src\/math\.test\.ts > math > case 0, /);
    expect(line).toContain("case 4 and 2 more; `/opt/squeal status` lists every one)");
    expect(line).not.toContain("case 5");
  });

  it("counts and names current failures only, then the earlier ones by validity", () => {
    const line = knownFailuresLine([
      failure("current"),
      failure("pendingA", "pending"),
      failure("pendingB", "pending"),
      failure("stale", "stale"),
    ]);
    expect(line).toBe(
      "Known failures: 1 (src/math.test.ts > math > current)\n" +
        "Earlier failures: 2 pending rerun, 1 stale (not counted until a rerun fails)",
    );
  });

  it("never reads as done while reruns are queued", () => {
    const failures = Array.from({ length: 38 }, (_, i) => failure(`t${i}`, "pending"));
    expect(knownFailuresLine(failures)).toBe(
      "Known failures: 0\n" +
        "Earlier failures: 38 pending rerun, 0 stale (not counted until a rerun fails)",
    );
  });
});
