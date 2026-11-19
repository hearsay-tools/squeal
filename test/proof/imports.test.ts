import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { changedImports, importsOf, stops, unusedPaths } from "../../src/core/proof/imports.js";
import { isRunnerConfig, unnamedInputs, unnamedReason } from "../../src/core/proof/inputs.js";
import { defaultCase, isTestSide, testSideCopies } from "../../src/core/proof/sides.js";

/*
 * Row 023-21, spec 023 D5.2 as amended 2026-11-19 ("A: stop guessing";
 * `reviews/wave-14-fourth.md`, `wave-14-fifth.md`): every changed file an
 * unchanged named test loads stops the file unless `--with` or `--source`
 * names it, under `test/` too; `--source` beats the test-side name rule;
 * the inputs its runs read are checked after them.
 */

const TEST = "test/a.test.ts";
const ref = { project: "", path: TEST };
const LOADS = [TEST, "support/rows.ts", "src/value.ts", "test/helpers/make.ts", "support/rows.py"];
const entry = (blob: string) => ({ mode: "100644", blob });

describe("an unchanged test's changed imports (row 023-21)", () => {
  it("keeps every changed import of an unchanged test, test folders and Python helpers included", () => {
    const changed = new Set([
      "support/rows.ts",
      "src/value.ts",
      "support/rows.py",
      "test/helpers/make.ts",
    ]);
    expect(changedImports(TEST, LOADS, changed, new Set([TEST]))).toEqual([
      "src/value.ts",
      "support/rows.py",
      "support/rows.ts",
      "test/helpers/make.ts",
    ]);
    expect(changedImports(TEST, LOADS, new Set([TEST, "src/value.ts"]), new Set([TEST]))).toEqual(
      [],
    );
  });

  it("stops on each one neither flag names", () => {
    const answer = importsOf({
      refs: [ref],
      loadsOf: () => LOADS,
      changed: new Set(["support/rows.ts", "src/value.ts", "test/helpers/make.ts"]),
      testSide: new Set([TEST, "support/rows.ts"]),
      source: new Set(["src/value.ts"]),
    });
    const imports = answer.imports.get(testFileId(ref)) ?? null;
    expect(imports).toEqual({ unsettled: ["test/helpers/make.ts"], sources: ["src/value.ts"] });
    expect(stops(imports)).toBe(true);
    expect(answer.candidates).toEqual(["src/value.ts", "test/helpers/make.ts"]);
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

  it("counts the changed inputs a run read, and every changed runner config, unless named", () => {
    const changed = new Set(["support/data.ts", "vitest.config.mjs", "src/value.ts", "README.md"]);
    const settled = new Set([TEST, "src/value.ts"]);
    expect(unnamedInputs(["support/data.ts", "src/value.ts"], changed, settled, null)).toEqual({
      paths: ["support/data.ts", "vitest.config.mjs"],
      unrecorded: null,
    });
    expect(
      unnamedInputs(["src/value.ts"], new Set(["src/value.ts", "README.md"]), settled, null),
    ).toBeNull();
    // Unrecorded reads: every changed path the call did not name counts.
    const none = unnamedInputs(null, changed, settled, "not recorded");
    expect(none).toEqual({
      paths: ["README.md", "support/data.ts", "vitest.config.mjs"],
      unrecorded: "not recorded",
    });
    expect(unnamedReason({ paths: ["a.ts"], unrecorded: null })).toBe(
      "changed input a.ts was not named",
    );
    expect(unnamedReason(none ?? { paths: [], unrecorded: null })).toBe(
      "changed inputs README.md, support/data.ts, vitest.config.mjs were not named; not recorded",
    );
  });

  it.each([
    ["vitest.config.mjs", true],
    ["pkg/vite.config.ts", true],
    ["squeal.config.json", true],
    ["pyproject.toml", true],
    ["tests/conftest.py", true],
    ["src/value.ts", false],
  ])("takes %s for a runner config: %s", (path, config) => {
    expect(isRunnerConfig(path)).toBe(config);
  });
});
