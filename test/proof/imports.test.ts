import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { importsOf, stops, unusedPaths } from "../../src/core/proof/imports.js";
import { defaultCase, isTestSide, testSideCopies } from "../../src/core/proof/sides.js";

/*
 * Row 023-21, spec 023 D5.2 as amended 2026-11-19 ("A: every changed
 * file"; `reviews/wave-14-sixth.md`): when a named test is unchanged, every
 * other changed file needs `--with` or `--source`; read marks are help only;
 * `--source` beats the test-side name rule.
 */

const TEST = "test/a.test.ts";
const ref = { project: "", path: TEST };
const entry = (blob: string) => ({ mode: "100644", blob });
const CHANGED = new Set([
  "docs/notes.md",
  "src/value.ts",
  "support/old.ts",
  "test/helpers/make.ts",
]);

describe("an unchanged test's changed files (row 023-21)", () => {
  it("lists every changed file but the named tests, whatever the test read; marks the read ones", () => {
    const answer = importsOf({
      refs: [ref],
      changed: CHANGED,
      testSide: new Set([TEST, "test/helpers/make.ts"]),
      source: new Set(["src/value.ts"]),
      seen: (_, path) => path === "support/old.ts",
    });
    const imports = answer.imports.get(testFileId(ref)) ?? null;
    expect(imports).toEqual({
      unsettled: ["docs/notes.md", "support/old.ts", "support/rows.py"],
      sources: ["src/value.ts"],
      read: ["support/old.ts"],
    });
    expect(stops(imports)).toBe(true);
    expect(answer.candidates).toEqual([...CHANGED].sort());
  });

  it("leaves a changed named test to the earlier rules, and runs once every file is named", () => {
    const changedTest = importsOf({
      refs: [ref],
      changed: new Set([TEST, "src/value.ts"]),
      testSide: new Set([TEST]),
      source: new Set(),
      seen: () => false,
    });
    expect(changedTest.imports.get(testFileId(ref))).toBeNull();
    expect(changedTest.candidates).toEqual(["src/value.ts"]);
    const named = importsOf({
      refs: [ref],
      changed: CHANGED,
      testSide: new Set([TEST, "test/helpers/make.ts", "support/old.ts", "support/rows.py"]),
      source: new Set(["src/value.ts", "docs/notes.md"]),
      seen: () => true,
    });
    expect(stops(named.imports.get(testFileId(ref)) ?? null)).toBe(false);
    expect(stops(null)).toBe(false);
    expect(unusedPaths(["a.ts", "b.ts"], [["a.ts"]])).toEqual(["b.ts"]);
  });

  it("lets --source beat the test-side name rule in copies and the default case", () => {
    const named = new Set([TEST]);
    const source = new Set(["test/value.ts"]);
    expect(isTestSide("test/value.ts", named)).toBe(true);
    expect(isTestSide("test/value.ts", named, source)).toBe(false);
    const tests = new Map([["test/value.ts", entry("v2")]]);
    const code = new Map([["test/value.ts", entry("v1")]]);
    expect(testSideCopies(tests, code, named)).toEqual(["test/value.ts"]);
    expect(testSideCopies(tests, code, named, source)).toEqual([]);
    const changed = new Set(["test/value.ts"]);
    expect(defaultCase(TEST, [TEST, "test/value.ts"], changed, named)).toBe("test");
    expect(defaultCase(TEST, [TEST, "test/value.ts"], changed, named, source)).toBe("source");
  });
});
