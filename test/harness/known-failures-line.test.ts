import { describe, expect, it } from "vitest";
import type { CheckId } from "../../src/core/types/index.js";
import { knownFailuresLine } from "../../src/harness/shared/text.js";

/*
 * Task 001-222: a Stop's `Known failures: N` names them, or the first few and
 * then where the rest are listed.
 */

const check = (name: string): CheckId => ({
  kind: "test",
  project: "",
  testPath: "src/math.test.ts",
  fullName: `math > ${name}`,
});

describe("knownFailuresLine", () => {
  it("is the bare count with none", () => {
    expect(knownFailuresLine([])).toBe("Known failures: 0");
  });

  it("names every failure up to five", () => {
    expect(knownFailuresLine([check("adds"), check("subtracts")])).toBe(
      "Known failures: 2 (src/math.test.ts > math > adds, src/math.test.ts > math > subtracts)",
    );
  });

  it("names the first five and points to status for the rest", () => {
    const failures = Array.from({ length: 7 }, (_, i) => check(`case ${i}`));
    const line = knownFailuresLine(failures, "/opt/squeal");
    expect(line).toMatch(/^Known failures: 7 \(src\/math\.test\.ts > math > case 0, /);
    expect(line).toContain("case 4 and 2 more; `/opt/squeal status` lists every one)");
    expect(line).not.toContain("case 5");
  });
});
