import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { NodeTestProject } from "../../../src/core/types/policy.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";
import { createNodeTestGraph } from "../../../src/runners/node-test/graph/index.js";
import { MANIFEST, observedClosure } from "./graph-observed.js";

/**
 * Row 018-62 (`research/node-test-left-out.md`, finding b): the node:test
 * graph keys what Node loads. b1, the one tsconfig tsx loads; b4, no
 * `?query` or `#hash` on a resolved path. Row 018-65 removed b2 and b3
 * (review 0.1.585, B1 and B2): the graph keeps every import Node could load,
 * so a closure may be one path too wide, never short. Each tree sits under
 * the repository, so a run under `--import tsx` finds tsx, and each closure
 * is compared with what that run loads.
 */

const scratch = join(
  resolve(import.meta.dirname, "../../fixtures/node-test"),
  ".tmp",
  randomUUID(),
);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const SLOW = { timeout: 60_000 } as const;
const TSX = ["--import", "tsx"];
const PACKAGE = `${JSON.stringify({ name: "keying", private: true, type: "module" })}\n`;

let count = 0;
function tree(files: Record<string, string>): string {
  const root = join(scratch, `t${count++}`);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return realpathSync(root);
}

const lines = (...text: string[]) => `${text.join("\n")}\n`;
const modules = (paths: readonly string[]) => paths.filter((p) => !MANIFEST.test(p)).sort();
const paths = (tsconfig: object) => `${JSON.stringify({ compilerOptions: tsconfig })}\n`;

async function closureOf(root: string, file: string, argv = TSX, tsconfigPath?: string) {
  const graph = await createNodeTestGraph({
    root,
    cwd: root,
    argv,
    testFiles: [file],
    tsconfigPath,
  });
  return graph.closure(file);
}

describe("b1: the tsconfig tsx loads", () => {
  const FILES = {
    "package.json": PACKAGE,
    "tsconfig.json": paths({ paths: { "~/*": ["./src/*"] } }),
    "tsconfig.alt.json": paths({ paths: { "~/*": ["./alt/*"] } }),
    "lib/tsconfig.json": paths({ paths: { "~/*": ["./other/*"] } }),
    "lib/x.ts": lines('import { y } from "~/y";', "export const x = y;"),
    "src/y.ts": "export const y = 1;\n",
    "alt/y.ts": "export const y = 3;\n",
    "lib/other/y.ts": "export const y = 2;\n",
    "test/a.test.ts": lines(
      'import { test } from "node:test";',
      'import { x } from "../lib/x.ts";',
      'test("x", () => void x);',
    ),
  };

  it(
    "keys the one found from cwd for every importer, not the importer's nearest",
    SLOW,
    async () => {
      const root = tree(FILES);
      const closure = await closureOf(root, "test/a.test.ts");
      expect(closure.paths).toContain("tsconfig.json");
      expect(closure.paths).not.toContain("lib/tsconfig.json");
      expect(modules(closure.paths)).toEqual(["lib/x.ts", "src/y.ts", "test/a.test.ts"]);
      expect(modules(closure.paths)).toEqual(observedClosure(root, root, TSX, "test/a.test.ts"));
    },
  );

  it("keys TSX_TSCONFIG_PATH in its place, relative to cwd", SLOW, async () => {
    const root = tree(FILES);
    const closure = await closureOf(root, "test/a.test.ts", TSX, "tsconfig.alt.json");
    expect(closure.paths).toContain("tsconfig.alt.json");
    expect(closure.paths).not.toContain("tsconfig.json");
    expect(modules(closure.paths)).toEqual(["alt/y.ts", "lib/x.ts", "test/a.test.ts"]);
    process.env.TSX_TSCONFIG_PATH = "tsconfig.alt.json";
    try {
      expect(modules(closure.paths)).toEqual(observedClosure(root, root, TSX, "test/a.test.ts"));
    } finally {
      delete process.env.TSX_TSCONFIG_PATH;
    }
  });

  it("takes TSX_TSCONFIG_PATH from the project's env in squeal.config.json", SLOW, async () => {
    const root = tree(FILES);
    const project: NodeTestProject = {
      name: "p",
      node: process.execPath,
      argv: TSX,
      env: { TSX_TSCONFIG_PATH: "tsconfig.alt.json" },
      include: ["test/*.test.ts"],
    };
    const adapter = await createNodeTestAdapter(project, { root, note: () => {} });
    const closure = await adapter.closure({ project: "p", path: "test/a.test.ts" });
    expect(closure.paths).toContain("alt/y.ts");
    expect(closure.paths).not.toContain("src/y.ts");
  });
});

describe("b4: a query or a hash on a specifier", () => {
  it("keys the file Node loads, under Node's rules and tsx's", SLOW, async () => {
    const root = tree({
      "package.json": PACKAGE,
      "src/query.mjs": "export const q = 1;\n",
      "src/hash.mjs": "export const h = 1;\n",
      "test/a.test.mjs": lines(
        'import { test } from "node:test";',
        'import { h } from "../src/hash.mjs#fragment";',
        'test("q", async () => void (await import("../src/query.mjs?darwin")) && void h);',
      ),
    });
    for (const argv of [[], TSX]) {
      const closure = await closureOf(root, "test/a.test.mjs", argv);
      expect(
        closure.paths.filter((p) => /[?#]/.test(p)),
        argv.join(" "),
      ).toEqual([]);
      expect(modules(closure.paths)).toEqual(["src/hash.mjs", "src/query.mjs", "test/a.test.mjs"]);
      expect(modules(closure.paths)).toEqual(observedClosure(root, root, argv, "test/a.test.mjs"));
    }
  });
});

/**
 * Review 0.1.585: the graph keeps every import Node could load. Each case is
 * a real `node --test` run whose test passes only when `dep` loads; the
 * graph must hold `dep` and select the test when `dep` changes.
 */
describe("review 0.1.585: no import Node loads is left out", () => {
  const ASSERT = 'import assert from "node:assert/strict";';
  const TEST = 'import { test } from "node:test";';
  const DEP_TS = lines('console.log("LOADED_DEP");', "export const Value = 2;");

  async function keeps(files: Record<string, string>, file: string, dep: string, argv = TSX) {
    const root = tree({ "package.json": PACKAGE, ...files });
    const graph = await createNodeTestGraph({ root, cwd: root, argv, testFiles: [file] });
    const closure = graph.closure(file);
    const observed = observedClosure(root, root, argv, file);
    expect(observed).toContain(dep);
    expect(closure.incomplete).toEqual([]);
    // One path too wide is allowed; one short is a wrong pass.
    expect(modules(closure.paths)).toEqual(expect.arrayContaining(observed));
    const affected = graph.affected([dep]);
    expect([...affected.direct, ...affected.transitive]).toEqual([file]);
    return modules(closure.paths);
  }

  const value = (...body: string[]) => ({
    "dep.ts": DEP_TS,
    "a.test.ts": lines(ASSERT, TEST, 'import { Value } from "./dep.ts";', ...body),
  });

  it("B1: keeps an import of a value named `type`, renamed", SLOW, async () => {
    const files = {
      "dep.ts": lines('console.log("LOADED_DEP");', "export const type = 2;"),
      "a.test.ts": lines(
        ASSERT,
        TEST,
        'import { type as Value } from "./dep.ts";',
        'test("value", () => assert.equal(Value, 2));',
      ),
    };
    expect(await keeps(files, "a.test.ts", "dep.ts")).toEqual(["a.test.ts", "dep.ts"]);
  });

  it("B2: keeps a value import after a division by a keyword-named property", SLOW, async () => {
    const files = value(
      "const result = ({ return: 8 }).return / Value / 2;",
      'test("value", () => assert.equal(result, 2));',
    );
    await keeps(files, "a.test.ts", "dep.ts");
  });

  it("B2: keeps a value import after a division of an object literal", SLOW, async () => {
    const files = value(
      "const result = ({ valueOf: () => 8 } as unknown as number) / Value / 2;",
      'test("value", () => assert.equal(result, 2));',
    );
    await keeps(files, "a.test.ts", "dep.ts");
  });

  it("B2: keeps a literal require after a division of an object literal", SLOW, async () => {
    const files = {
      "dep.cjs": lines('console.log("LOADED_DEP");', "module.exports = 2;"),
      "a.test.cjs": lines(
        'const { test } = require("node:test");',
        'const assert = require("node:assert/strict");',
        'const result = { valueOf: () => 8 } / require("./dep.cjs") / 2;',
        'test("value", () => assert.equal(result, 2));',
      ),
    };
    for (const argv of [[], TSX]) await keeps(files, "a.test.cjs", "dep.cjs", argv);
  });

  it("keeps an import tsx drops for a type-only binding: one path too wide", SLOW, async () => {
    const files = {
      "dep.ts": DEP_TS,
      "a.test.ts": lines(
        ASSERT,
        TEST,
        'import { type Value } from "./dep.ts";',
        "const v: Value | null = null;",
        'test("type", () => assert.equal(v, null));',
      ),
    };
    const root = tree({ "package.json": PACKAGE, ...files });
    const closure = await closureOf(root, "a.test.ts");
    expect(observedClosure(root, root, TSX, "a.test.ts")).toEqual(["a.test.ts"]);
    expect(modules(closure.paths)).toEqual(["a.test.ts", "dep.ts"]);
  });

  // The review's positive controls: each loads `dep`, and the graph held it.
  const CONTROLS: Record<string, Record<string, string>> = {
    "an enum": value("enum E { a = Value }", 'test("v", () => assert.equal(E.a, 2));'),
    "a value re-export": {
      "dep.ts": DEP_TS,
      "re.ts": 'export { Value } from "./dep.ts";\n',
      "a.test.ts": lines(
        ASSERT,
        TEST,
        'import { Value } from "./re.ts";',
        'test("v", () => assert.equal(Value, 2));',
      ),
    },
    "a side-effect import": {
      "dep.ts": lines("(globalThis as { v?: number }).v = 2;", "export {};"),
      "a.test.ts": lines(
        ASSERT,
        TEST,
        'import "./dep.ts";',
        'test("v", () => assert.equal((globalThis as { v?: number }).v, 2));',
      ),
    },
    "a mixed inline type and value import": {
      "dep.ts": lines(DEP_TS, "export type T = number;"),
      "a.test.ts": lines(
        ASSERT,
        TEST,
        'import { type T, Value } from "./dep.ts";',
        "const v: T = Value;",
        'test("v", () => assert.equal(v, 2));',
      ),
    },
    "a template expression": value(
      "const s = `$" + "{Value}`;",
      'test("v", () => assert.equal(s, "2"));',
    ),
    "JSX in .tsx": {
      "dep.ts": DEP_TS,
      "a.test.tsx": lines(
        ASSERT,
        TEST,
        'import { Value } from "./dep.ts";',
        "const React = { createElement: (_t: unknown, p: { v: number }) => p.v };",
        "const out = <div v={Value} />;",
        'test("v", () => assert.equal(out, 2));',
      ),
    },
  };

  for (const [name, files] of Object.entries(CONTROLS)) {
    it(`keeps the dependency of ${name}`, SLOW, async () => {
      const file = Object.keys(files).find((f) => f.startsWith("a.test")) ?? "";
      await keeps(files, file, "dep.ts");
    });
  }
});
