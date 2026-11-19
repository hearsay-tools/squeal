import { describe, expect, it } from "vitest";
import {
  reachesTestApi,
  resolveLocal,
  specifiersOf,
  type Tree,
  testApiOf,
} from "../../src/core/proof/import-graph.js";
import {
  codeSideChanges,
  type Settling,
  settle,
  stops,
  unusedPaths,
} from "../../src/core/proof/imports.js";

/*
 * Row 023-21, spec 023 D5.2 as amended 2026-11-19 (the human, "A: stop
 * when unsure"; `reviews/wave-14-rereview.md` B1): a changed import of an
 * unchanged named test is product code only when a file that is not test
 * code imports it, or `--source` names it; test code is found through
 * local imports (a barrel included); everything else stops.
 */

/** An in-memory commit. */
function tree(commit: string, files: Record<string, string>): Tree {
  return {
    commit,
    has: (path) => path in files,
    text: async (path) => files[path] ?? null,
  };
}

const HEAD = "h".repeat(40);
const BASE = "b".repeat(40);
const TEST = "test/a.test.ts";

function settling(head: Record<string, string>, more: Partial<Settling> = {}): Settling {
  const t = tree(HEAD, head);
  return {
    testSide: new Set([TEST]),
    source: new Set(),
    head: t,
    base: tree(BASE, head),
    candidates: async () => Object.keys(head),
    ...more,
  };
}

describe("an unchanged test's changed imports (row 023-21)", () => {
  it("keeps the code-side changes of an unchanged test only", () => {
    const loads = [TEST, "support/rows.ts", "src/value.ts", "test/helpers/make.ts"];
    const named = new Set([TEST]);
    const changed = new Set(["support/rows.ts", "test/helpers/make.ts"]);
    expect(codeSideChanges(TEST, loads, changed, named)).toEqual({
      code: ["support/rows.ts"],
      testSide: true,
    });
    expect(codeSideChanges(TEST, loads, new Set([TEST, "src/value.ts"]), named).code).toEqual([]);
  });

  it.each([
    ["support/rows.ts", 'import { it, expect } from "vitest";\n', "vitest"],
    ["support/rows.mjs", "const { test } = require('node:test');\n", "node:test"],
    ["e2e/page.ts", 'import { test } from "@playwright/test";\n', "@playwright/test"],
    ["support/api.ts", 'export { it, expect } from "vitest";\n', "vitest"],
    ["support/mocks.ts", 'const m = await import("@vitest/spy");\n', "@vitest/spy"],
    ["support/rows.py", "import os\nimport pytest\n", "pytest"],
    ["support/case.py", "from unittest import mock\n", "unittest"],
    ["src/value.ts", 'import { join } from "node:path";\nexport const vitest = 1;\n', null],
    ["src/run.py", "import pytesting\n# import pytest is only a comment\n", null],
    ["src/data.json", '{"import": "vitest"}', null],
  ])("reads %s's own test API: %s", (path, text, api) => {
    expect(testApiOf(path, text)).toBe(api);
  });

  it("resolves local imports in TypeScript and Python, never a package", () => {
    const files = new Set([
      "support/api.ts",
      "src/value.ts",
      "src/lib/index.ts",
      "pkg/a/b.py",
      "pkg/a/__init__.py",
      "pkg/c.py",
    ]);
    const has = (p: string) => files.has(p);
    expect(resolveLocal("support/rows.ts", "./api", has)).toBe("support/api.ts");
    expect(resolveLocal("support/rows.ts", "./api.js", has)).toBe("support/api.ts");
    expect(resolveLocal("support/rows.ts", "../src/value", has)).toBe("src/value.ts");
    expect(resolveLocal("src/main.ts", "./lib", has)).toBe("src/lib/index.ts");
    expect(resolveLocal("src/main.ts", "vitest", has)).toBeNull();
    expect(resolveLocal("pkg/a/b.py", ".", has)).toBe("pkg/a/__init__.py");
    expect(resolveLocal("pkg/a/b.py", "..c", has)).toBe("pkg/c.py");
    expect(resolveLocal("tests/test_x.py", "pkg.a.b", has)).toBe("pkg/a/b.py");
    expect(specifiersOf("pkg/a/b.py", "from . import b, c\nimport pkg.c as c\n")).toEqual([
      "pkg.c",
      ".",
      ".b",
      ".c",
    ]);
  });

  it("finds a test API through a local barrel", async () => {
    const t = tree(HEAD, {
      "support/rows.ts": 'import { it } from "./api";\nimport { value } from "../src/value";\n',
      "support/api.ts": 'export { it, expect } from "vitest";\n',
      "src/value.ts": "export const value = 1;\n",
    });
    expect(await reachesTestApi("support/rows.ts", t)).toEqual({
      api: "vitest",
      via: ["support/api.ts"],
    });
    expect(await reachesTestApi("src/value.ts", t)).toBe("none");
  });

  it("settles a changed import as product code only by a non-test importer or --source", async () => {
    const files = {
      [TEST]: 'import { runRows } from "../support/rows";\n',
      "support/rows.ts": 'import { it } from "./api";\nimport { min } from "./data";\n',
      "support/api.ts": 'export { it, expect } from "vitest";\n',
      "support/data.ts": "export const min = 1;\n",
      "src/value.ts": "export const value = 2;\n",
      "src/main.ts": 'import { value } from "./value";\n',
      "src/only.ts": "export const only = 1;\n",
    };
    const s = settling({
      ...files,
      "support/rows.ts": `${files["support/rows.ts"]}import "../src/only";\n`,
    });
    expect(await settle("support/rows.ts", s)).toEqual({
      unsettled: {
        path: "support/rows.ts",
        testCode: true,
        why: "imports vitest through support/api.ts at hhhhhhhhh",
      },
    });
    expect(await settle("support/data.ts", s)).toEqual({
      unsettled: {
        path: "support/data.ts",
        testCode: false,
        why: "no project file that is not test code imports it",
      },
    });
    expect(await settle("src/value.ts", s)).toEqual({
      settled: { path: "src/value.ts", why: "imported by src/main.ts" },
    });
    // Imported by test code only: not settled, whatever its folder.
    expect(await settle("src/only.ts", s)).toMatchObject({ unsettled: { testCode: false } });
    const given = settling(files, { source: new Set(["src/only.ts"]) });
    expect(await settle("src/only.ts", given)).toEqual({
      settled: { path: "src/only.ts", why: "--source" },
    });
  });

  it("takes test code at base too, and a conftest by its role", async () => {
    const head = { "support/rows.ts": "export const rows = [1];\n", "pkg/conftest.py": "X = 1\n" };
    const s = settling(head, {
      base: tree(BASE, { "support/rows.ts": 'import { it } from "vitest";\n' }),
    });
    expect(await settle("support/rows.ts", s)).toMatchObject({
      unsettled: { testCode: true, why: "imports vitest at bbbbbbbbb" },
    });
    expect(await settle("pkg/conftest.py", s)).toMatchObject({
      unsettled: { testCode: true, why: "pytest's conftest.py" },
    });
  });

  it("stops on any unsettled import, and names unused --with and --source paths", () => {
    expect(stops(null)).toBe(false);
    expect(stops({ unsettled: [], sources: [], testSide: false })).toBe(false);
    expect(
      stops({
        unsettled: [{ path: "a", testCode: false, why: "x" }],
        sources: [],
        testSide: false,
      }),
    ).toBe(true);
    expect(unusedPaths(["a.ts", "b.ts", "c.ts"], [["a.ts"], ["x.ts", "c.ts"]])).toEqual(["b.ts"]);
  });
});
