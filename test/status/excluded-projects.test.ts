import { describe, expect, it } from "vitest";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { NOW, seed } from "./slow-tier-seed.js";

/*
 * Spec 001 D7, D11 (task 001-349): `squeal status` names each Vitest
 * project `vitest.excludeProjects` lists as not run.
 */

function statusOf(policy: object | null): { snapshot: StatusSnapshot; text: string } {
  const s = seed(policy);
  const snapshot = readStatus(s.repo.main, { now: () => NOW }) as StatusSnapshot;
  return { snapshot, text: formatStatus(snapshot, NOW) };
}

describe("status names the excluded Vitest projects (001-349)", () => {
  it("one line under the checkpoint lines, each project named", () => {
    const { snapshot, text } = statusOf({ vitest: { excludeProjects: ["e2e", "bench"] } });
    expect(snapshot.vitestExcluded).toEqual(["e2e", "bench"]);
    expect(text.split("\n")).toContain(
      'Not run: Vitest projects "e2e" and "bench", excluded by squeal.config.json',
    );
  });

  it("a pattern as a selector, since no project has its name (001-370, review S2)", () => {
    const { snapshot, text } = statusOf({ vitest: { excludeProjects: ["e2e", "E*", "*-bench"] } });
    expect(snapshot.vitestExcluded).toEqual(["e2e", "E*", "*-bench"]);
    expect(text.split("\n")).toContain(
      'Not run: Vitest project "e2e" and projects matching "E*" or "*-bench", excluded by squeal.config.json',
    );
    expect(formatStatus({ ...snapshot, vitestExcluded: ["E*"] }, NOW).split("\n")).toContain(
      'Not run: Vitest projects matching "E*", excluded by squeal.config.json',
    );
  });

  it("nothing without the key", () => {
    const { snapshot, text } = statusOf(null);
    expect(snapshot.vitestExcluded).toBeUndefined();
    expect(text).not.toContain("Not run:");
  });

  it("names the vitest.exclude globs on a line of their own (004-81)", () => {
    const { snapshot, text } = statusOf({ vitest: { exclude: ["test/e2e/**"] } });
    expect(snapshot.vitestExcludedFiles).toEqual(["test/e2e/**"]);
    expect(snapshot.vitestExcluded).toBeUndefined();
    expect(text.split("\n")).toContain(
      'Not run: Vitest test files matching "test/e2e/**", excluded by squeal.config.json',
    );
    const many = ["a/**", "b/**", "c/**", "d/**", "e/**"];
    expect(formatStatus({ ...snapshot, vitestExcludedFiles: many }, NOW).split("\n")).toContain(
      'Not run: Vitest test files matching "a/**", "b/**", "c/**" and 2 more globs, excluded by squeal.config.json',
    );
  });
});
