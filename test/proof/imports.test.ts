import { describe, expect, it } from "vitest";
import {
  changedImports,
  stops,
  testApiOf,
  testCodeWhy,
  unusedWith,
} from "../../src/core/proof/imports.js";

/*
 * Row 023-21, spec 023 D5.2 as amended 2026-11-19 (issue #247), repaired
 * after `reviews/wave-14.md` B1: an unchanged named test's changed imports,
 * split by their own text into test code (a test API import at HEAD or at
 * base, pytest's conftest, a helper name), which stops the file, and
 * source, which the proof compares; test-side changes are copied already.
 */

const THIN = "test/a.test.ts";
const HEAD = "h".repeat(40);
const BASE = "b".repeat(40);
const LOADS = [THIN, "support/rows.ts", "src/value.ts", "test/helpers/make.ts"];

describe("an unchanged test's changed imports (row 023-21)", () => {
  it("splits code-side changes into test code and sources; test code stops the file", () => {
    const changed = new Set(["support/rows.ts", "src/value.ts", "src/other.ts"]);
    const why = (path: string) => (path === "support/rows.ts" ? "imports vitest at h" : null);
    const imports = changedImports(THIN, LOADS, changed, new Set([THIN]), why);
    expect(imports).toEqual({
      testCode: [{ path: "support/rows.ts", why: "imports vitest at h" }],
      sources: ["src/value.ts"],
      testSide: false,
    });
    expect(stops(imports)).toBe(true);
  });

  it("is null when the test changed, or no code-side import did", () => {
    const named = new Set([THIN]);
    const why = () => "x";
    expect(changedImports(THIN, LOADS, new Set([THIN, "support/rows.ts"]), named, why)).toBeNull();
    expect(changedImports(THIN, LOADS, new Set(["test/helpers/make.ts"]), named, why)).toBeNull();
    expect(stops(null)).toBe(false);
  });

  it("takes a --with path for test-side: the file no longer stops", () => {
    const changed = new Set(["support/rows.ts", "src/value.ts"]);
    const testSide = new Set([THIN, "support/rows.ts"]);
    const imports = changedImports(THIN, LOADS, changed, testSide, () => null);
    expect(imports).toEqual({ testCode: [], sources: ["src/value.ts"], testSide: true });
    expect(stops(imports)).toBe(false);
  });

  it.each([
    ["support/rows.ts", 'import { it, expect } from "vitest";\n', "vitest"],
    ["support/rows.mjs", "const { test } = require('node:test');\n", "node:test"],
    ["e2e/page.ts", 'import { test } from "@playwright/test";\n', "@playwright/test"],
    [
      "support/dom.tsx",
      'import { render } from "@testing-library/react";\n',
      "@testing-library/react",
    ],
    ["support/mocks.ts", 'const m = await import("@vitest/spy");\n', "@vitest/spy"],
    ["support/rows.py", "import os\nimport pytest\n", "pytest"],
    ["support/case.py", "from unittest import mock\n", "unittest"],
    ["src/value.ts", 'import { join } from "node:path";\nexport const vitest = 1;\n', null],
    ["src/run.py", "import pytesting\n# import pytest is only a comment\n", null],
    ["src/data.json", '{"import": "vitest"}', null],
  ])("reads %s's test API: %s", (path, text, api) => {
    expect(testApiOf(path, text)).toBe(api);
  });

  it("takes a file for test code by its text at HEAD or at base, a conftest, or a helper name", () => {
    const vitest = 'import { it } from "vitest";\n';
    const plain = "export const rows = [1, 2];\n";
    const at = (head: string | null, base: string | null) => [
      { commit: HEAD, text: head },
      { commit: BASE, text: base },
    ];
    expect(testCodeWhy("support/rows.ts", at(vitest, plain))).toBe("imports vitest at hhhhhhhhh");
    expect(testCodeWhy("support/rows.ts", at(plain, vitest))).toBe("imports vitest at bbbbbbbbb");
    expect(testCodeWhy("support/new.ts", at(vitest, null))).toBe("imports vitest at hhhhhhhhh");
    expect(testCodeWhy("pkg/conftest.py", at("x = 1\n", null))).toBe("pytest's conftest.py");
    expect(testCodeWhy("src/rows.testkit.ts", at(plain, plain))).toBe("a test helper's name");
    // The known blind spot: pure data with an ordinary name counts as source.
    expect(testCodeWhy("support/rows.ts", at(plain, plain))).toBeNull();
    // A runner config imports vitest/config and is compared as source.
    expect(testCodeWhy("vitest.config.ts", at('import "vitest/config";\n', null))).toBeNull();
  });

  it("names the --with paths no closure loads", () => {
    expect(unusedWith(["a.ts", "b.ts", "c.ts"], [["a.ts"], ["x.ts", "c.ts"]])).toEqual(["b.ts"]);
    expect(unusedWith([], [["a.ts"]])).toEqual([]);
  });
});
