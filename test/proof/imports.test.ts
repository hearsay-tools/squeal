import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { codeSideChanges, importsOf, stops, unusedPaths } from "../../src/core/proof/imports.js";

/*
 * Row 023-21, spec 023 D5.2 as amended 2026-11-19 (last, the human after
 * `reviews/wave-14-fourth.md`, "A: stop guessing"): every changed file an
 * unchanged named test loads that is not on the test side stops the file
 * unless `--with` or `--source` names it. No file is classified.
 */

const TEST = "test/a.test.ts";
const ref = { project: "", path: TEST };
const LOADS = [TEST, "support/rows.ts", "src/value.ts", "test/helpers/make.ts", "support/rows.py"];

describe("an unchanged test's changed imports (row 023-21)", () => {
  it("keeps every changed code-side import of an unchanged test, whatever it imports", () => {
    const changed = new Set([
      "support/rows.ts",
      "src/value.ts",
      "support/rows.py",
      "test/helpers/make.ts",
    ]);
    expect(codeSideChanges(TEST, LOADS, changed, new Set([TEST]))).toEqual({
      code: ["src/value.ts", "support/rows.py", "support/rows.ts"],
      testSide: true,
    });
    expect(
      codeSideChanges(TEST, LOADS, new Set([TEST, "src/value.ts"]), new Set([TEST])).code,
    ).toEqual([]);
  });

  it("stops on each one neither flag names; --with copies it, --source settles it", () => {
    const changed = new Set(["support/rows.ts", "src/value.ts", "support/rows.py"]);
    const answer = importsOf({
      refs: [ref],
      loadsOf: () => LOADS,
      changed,
      testSide: new Set([TEST, "support/rows.ts"]),
      source: new Set(["src/value.ts"]),
    });
    const imports = answer.imports.get(testFileId(ref)) ?? null;
    expect(imports).toEqual({
      unsettled: ["support/rows.py"],
      sources: ["src/value.ts"],
      testSide: true,
    });
    expect(stops(imports)).toBe(true);
    expect(answer.candidates).toEqual(["src/value.ts", "support/rows.py"]);
    const settled = importsOf({
      refs: [ref],
      loadsOf: () => LOADS,
      changed,
      testSide: new Set([TEST, "support/rows.ts", "support/rows.py"]),
      source: new Set(["src/value.ts"]),
    });
    expect(stops(settled.imports.get(testFileId(ref)) ?? null)).toBe(false);
  });

  it("gives no imports for a changed test or one with no changed imports", () => {
    const of = (changed: string[]) =>
      importsOf({
        refs: [ref],
        loadsOf: () => LOADS,
        changed: new Set(changed),
        testSide: new Set([TEST]),
        source: new Set(),
      }).imports.get(testFileId(ref));
    expect(of([TEST, "src/value.ts"])).toBeNull();
    expect(of(["src/other.ts"])).toBeNull();
    expect(stops(null)).toBe(false);
  });

  it("names unused --with and --source paths", () => {
    expect(unusedPaths(["a.ts", "b.ts", "c.ts"], [["a.ts"], ["x.ts", "c.ts"]])).toEqual(["b.ts"]);
  });
});
