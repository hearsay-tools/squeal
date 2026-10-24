import { describe, expect, it } from "vitest";
import { namePattern } from "../../../src/runners/vitest/name-pattern.js";

/*
 * Row 011-173 (013 V4, review 0.1.278 N1): a focused file's `testNamePattern`
 * reads a text's ` > ` as the join of the Vitest that runs it.
 */
describe("vitest focused-run name pattern", () => {
  it("matches ` > ` alone on Vitest 5 and later, the join of their full names", () => {
    for (const version of ["5.0.3", "5.1.0-beta.2", "6.0.0"]) {
      expect(namePattern(["a > b"], version).test("a > b")).toBe(true);
      expect(namePattern(["a > b"], version).test("a b")).toBe(false);
    }
  });

  it("keeps ` > ` or a space on Vitest 4 and on a version it cannot read", () => {
    for (const version of ["4.1.10", "4.0.0-beta.1", ""]) {
      expect(namePattern(["a > b"], version).test("a > b")).toBe(true);
      expect(namePattern(["a > b"], version).test("a b")).toBe(true);
    }
  });
});
