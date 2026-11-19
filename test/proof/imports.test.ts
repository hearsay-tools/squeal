import { describe, expect, it } from "vitest";
import { changedImports, stops, unusedWith } from "../../src/core/proof/imports.js";

/*
 * Row 023-21, spec 023 D5.2 as amended 2026-11-19 (issue #247): an
 * unchanged named test's changed imports, split into the code-side helpers
 * (`--with` candidates, which stop the file) and the source the proof
 * compares; test-side changes are copied already.
 */

const THIN = "src/thin.test.ts";
const LOADS = [THIN, "src/rows.testkit.ts", "src/value.ts", "test/helpers/make.ts"];

describe("an unchanged test's changed imports (row 023-21)", () => {
  it("splits code-side changes into helpers and sources; a helper stops the file", () => {
    const changed = new Set(["src/rows.testkit.ts", "src/value.ts", "src/other.ts"]);
    const imports = changedImports(THIN, LOADS, changed, new Set([THIN]));
    expect(imports).toEqual({
      helpers: ["src/rows.testkit.ts"],
      sources: ["src/value.ts"],
      testSide: false,
    });
    expect(stops(imports)).toBe(true);
  });

  it("is null when the test changed, or no code-side import did", () => {
    const named = new Set([THIN]);
    expect(changedImports(THIN, LOADS, new Set([THIN, "src/rows.testkit.ts"]), named)).toBeNull();
    expect(changedImports(THIN, LOADS, new Set(["test/helpers/make.ts"]), named)).toBeNull();
    expect(stops(null)).toBe(false);
  });

  it("takes a --with path for test-side: the file no longer stops", () => {
    const changed = new Set(["src/rows.testkit.ts", "src/value.ts"]);
    const imports = changedImports(THIN, LOADS, changed, new Set([THIN, "src/rows.testkit.ts"]));
    expect(imports).toEqual({ helpers: [], sources: ["src/value.ts"], testSide: true });
    expect(stops(imports)).toBe(false);
  });

  it.each([
    ["src/testing/make.ts", true],
    ["src/mocks/api.ts", true],
    ["src/test-utils.ts", true],
    ["src/rowsKit.ts", false],
    ["src/value.ts", false],
  ])("takes %s for a helper: %s", (path, helper) => {
    const imports = changedImports(THIN, [THIN, path], new Set([path]), new Set([THIN]));
    expect(imports?.helpers.length === 1).toBe(helper);
    expect(imports?.sources.length === 1).toBe(!helper);
  });

  it("names the --with paths no closure loads", () => {
    expect(unusedWith(["a.ts", "b.ts", "c.ts"], [["a.ts"], ["x.ts", "c.ts"]])).toEqual(["b.ts"]);
    expect(unusedWith([], [["a.ts"]])).toEqual([]);
  });
});
