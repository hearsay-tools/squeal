import { describe, expect, it } from "vitest";
import {
  importsIn,
  REACH_LIMIT,
  reachesTestApi,
  resolveJs,
  type Tree,
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
 * when unsure"; `reviews/wave-14-rereview.md` B1, `reviews/wave-14-third.md`
 * 1 and 2): a changed import of an unchanged named test is product code
 * only when `--source` names it or an importer is shown not to be test
 * code: every import it reaches parses, resolves and reaches no test API.
 * Imports are read by Squeal's parsers: comments and strings name nothing.
 */

const HEAD = "h".repeat(40);
const BASE = "b".repeat(40);
const TEST = "test/a.test.ts";
const PACKAGE = { "package.json": '{"name":"fixture","devDependencies":{"vitest":"5"}}\n' };

/** An in-memory commit. */
function tree(commit: string, files: Record<string, string>): Tree {
  return {
    commit,
    has: (path) => path in files,
    paths: () => Object.keys(files),
    text: async (path) => files[path] ?? null,
  };
}

function settling(head: Record<string, string>, more: Partial<Settling> = {}): Settling {
  return {
    testSide: new Set([TEST]),
    source: new Set(),
    head: tree(HEAD, head),
    base: tree(BASE, head),
    candidates: async () => Object.keys(head),
    ...more,
  };
}

const imports = (path: string, text: string, more: Record<string, string> = {}) =>
  importsIn(path, tree(HEAD, { ...PACKAGE, [path]: text, ...more }));

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
    ["support/rows.ts", 'import { it, expect } from "vitest";\n', ["vitest"]],
    ["support/rows.cjs", "const { test } = require('node:test');\n", ["node:test"]],
    ["support/api.ts", 'export { it, expect } from "vitest";\n', ["vitest"]],
    ["support/spy.ts", 'const m = await import("@vitest/spy");\n', ["@vitest/spy"]],
    ["support/rows.py", "import os\nimport pytest\n", ["pytest"]],
    ["support/case.py", "from unittest import mock\n", ["unittest"]],
    ["src/value.ts", 'import { join } from "node:path";\nexport const vitest = 1;\n', []],
  ])("reads %s's own test APIs with the parser", async (path, text, tests) => {
    expect((await imports(path, text)).tests).toEqual(tests);
  });

  it.each([
    ["a line comment", '// import { min } from "../support/data";\nexport const x = 1;\n'],
    ["a block comment", '/* import { min } from "../support/data"; */\nexport const x = 1;\n'],
    ["a string literal", "export const s = 'import { min } from \"../support/data\"';\n"],
    ["a require in a comment", '// const d = require("../support/data");\nexport const x = 1;\n'],
    ["a template literal", 'export const t = `import "../support/data"`;\n'],
  ])("finds no import in %s", async (_, text) => {
    const found = await imports("src/example.ts", text, {
      "support/data.ts": "export const min = 1;\n",
    });
    expect(found).toEqual({ local: [], tests: [], unresolved: [] });
  });

  it("finds no import in a Python comment or string", async () => {
    const text = '# import pytest\nDOC = """\nimport pytest\nfrom support import data\n"""\n';
    expect(await imports("pkg/doc.py", text)).toEqual({ local: [], tests: [], unresolved: [] });
  });

  it("accounts for each import: local, builtin, declared package; an alias or unknown bare name is unresolved", async () => {
    const files = {
      "src/value.ts": "export const value = 1;\n",
      "src/lib/index.ts": "export const lib = 1;\n",
    };
    const text = [
      'import { value } from "./value.js";',
      'import { lib } from "./lib";',
      'import { join } from "node:path";',
      'import { readFileSync } from "fs";',
      'import { expect } from "vitest";',
      'import { api } from "#api";',
      'import { rows } from "~/rows";',
      'import { other } from "left-pad";',
      'import { gone } from "./gone";',
      "",
    ].join("\n");
    expect(await imports("src/main.ts", text, files)).toEqual({
      local: ["src/value.ts", "src/lib/index.ts"],
      tests: ["vitest"],
      unresolved: [
        "could not resolve #api in src/main.ts",
        "could not resolve ~/rows in src/main.ts",
        "could not resolve left-pad in src/main.ts",
        "could not resolve ./gone in src/main.ts",
      ],
    });
  });

  it("resolves Python imports from the package and the folders above; a local name it cannot find is unresolved", async () => {
    const files = {
      "pkg/__init__.py": "",
      "pkg/value.py": "VALUE = 1\n",
      "pkg/helpers/__init__.py": "",
    };
    const text =
      "import os\nimport numpy\nfrom . import value\nfrom pkg.value import VALUE\nimport helpers.missing\n";
    expect(await imports("pkg/main.py", text, files)).toEqual({
      local: ["pkg/__init__.py", "pkg/value.py", "pkg/value.py"],
      tests: [],
      unresolved: ["could not resolve helpers.missing in pkg/main.py"],
    });
  });

  it("resolves a relative JavaScript specifier by extension, .js as .ts and index", () => {
    const t = tree(HEAD, { "support/api.ts": "", "src/lib/index.ts": "" });
    expect(resolveJs("support/rows.ts", "./api.js", t)).toBe("support/api.ts");
    expect(resolveJs("src/main.ts", "./lib", t)).toBe("src/lib/index.ts");
    expect(resolveJs("src/main.ts", "../../outside", t)).toBeNull();
  });

  it("finds a test API through a local barrel, and answers unknown past an alias or the walk limit", async () => {
    const t = tree(HEAD, {
      ...PACKAGE,
      "support/rows.ts": 'import { it } from "./api";\nimport { value } from "../src/value";\n',
      "support/api.ts": 'export { it, expect } from "vitest";\n',
      "src/value.ts": "export const value = 1;\n",
      "support/aliased.ts": 'import { it } from "#api";\n',
    });
    expect(await reachesTestApi("support/rows.ts", t)).toEqual({
      api: "vitest",
      via: ["support/api.ts"],
    });
    expect(await reachesTestApi("src/value.ts", t)).toBe("none");
    expect(await reachesTestApi("support/aliased.ts", t)).toEqual({
      unknown: "could not resolve #api in support/aliased.ts",
    });
    const chain: Record<string, string> = {};
    for (let i = 0; i <= REACH_LIMIT + 1; i++) chain[`m/f${i}.ts`] = `import "./f${i + 1}";\n`;
    chain[`m/f${REACH_LIMIT + 2}.ts`] = "export {};\n";
    expect(await reachesTestApi("m/f0.ts", tree(HEAD, chain))).toEqual({
      unknown: `more than ${REACH_LIMIT} local imports to follow from m/f0.ts`,
    });
  });

  it("settles a changed import as product code only by an importer shown not to be test code, or --source", async () => {
    const files = {
      ...PACKAGE,
      [TEST]: 'import { runRows } from "../support/rows";\n',
      "support/rows.ts":
        'import { it } from "./api";\nimport { min } from "./data";\nimport "../src/only";\n',
      "support/api.ts": 'export { it, expect } from "vitest";\n',
      "support/data.ts": "export const min = 1;\n",
      "src/value.ts": "export const value = 2;\n",
      "src/main.ts": 'import { value } from "./value";\n',
      "src/only.ts": "export const only = 1;\n",
      "src/example.ts":
        '// import { min } from "../support/data";\nexport const label = "example";\n',
    };
    const s = settling(files);
    expect(await settle("support/rows.ts", s)).toEqual({
      unsettled: {
        path: "support/rows.ts",
        testCode: true,
        why: "imports vitest through support/api.ts at hhhhhhhhh",
      },
    });
    // Third look 2: src/example.ts only mentions data in a comment.
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
    expect(await settle("src/only.ts", s)).toMatchObject({ unsettled: { testCode: false } });
    expect(
      await settle("src/only.ts", settling(files, { source: new Set(["src/only.ts"]) })),
    ).toEqual({
      settled: { path: "src/only.ts", why: "--source" },
    });
  });

  it("gives no evidence from an importer, or a changed file, with an unresolved import", async () => {
    const files = {
      ...PACKAGE,
      "support/rows.ts": 'import { it } from "#api";\nimport { min } from "./data";\n',
      "support/data.ts": "export const min = 1;\n",
      "src/aliased.ts": 'import { x } from "~/x";\nexport const y = 1;\n',
    };
    // Third look 1: rows takes vitest through #api, which is not read; it is no evidence for data.
    expect(await settle("support/data.ts", settling(files))).toEqual({
      unsettled: {
        path: "support/data.ts",
        testCode: false,
        why: "could not resolve #api in support/rows.ts",
      },
    });
    expect(await settle("src/aliased.ts", settling(files))).toEqual({
      unsettled: {
        path: "src/aliased.ts",
        testCode: false,
        why: "could not resolve ~/x in src/aliased.ts",
      },
    });
  });

  it("takes test code at base too, and a conftest by its role", async () => {
    const head = {
      ...PACKAGE,
      "support/rows.ts": "export const rows = [1];\n",
      "pkg/conftest.py": "X = 1\n",
    };
    const s = settling(head, {
      base: tree(BASE, { ...PACKAGE, "support/rows.ts": 'import { it } from "vitest";\n' }),
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
