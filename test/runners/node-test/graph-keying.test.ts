import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { NodeTestProject } from "../../../src/core/types/policy.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";
import { createNodeTestGraph } from "../../../src/runners/node-test/graph/index.js";
import { parseModule, parserReady } from "../../../src/runners/node-test/graph/parse.js";
import { MANIFEST, observedClosure } from "./graph-observed.js";

/**
 * Row 018-62 (`research/node-test-left-out.md`, finding b): the node:test
 * graph keys what Node loads. b1, the one tsconfig tsx loads; b2, no import
 * tsx's esbuild drops; b3, no `require` in a string or a comment; b4, no
 * `?query` or `#hash` on a resolved path. Each tree sits under the repository,
 * so a run under `--import tsx` finds tsx, and each closure is compared with
 * what that run loads.
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

describe("b2: an import tsx's esbuild drops", () => {
  const parse = (source: string, name = "m.ts", elideTypeImports = true) =>
    parseModule(source, name, { elideTypeImports }).specifiers.map((s) => s.specifier);

  it("leaves out an import whose every binding is used only as a type, or not at all", async () => {
    await parserReady;
    const source = lines(
      'import { A } from "./type-use";',
      'import B, { type C } from "./mixed-types";',
      'import { D } from "./typeof";',
      'import { E } from "./unused";',
      'import { type F } from "./inline-type";',
      'import { G } from "./value";',
      'import * as H from "./namespace";',
      'import { I } from "./in-string";',
      'import "./side-effect";',
      'export { J } from "./reexport";',
      "export function f(a: A, b: B<C>, d: typeof D): void {",
      "  new G(); H.run();",
      '  console.log("I");',
      "}",
    );
    expect(parse(source)).toEqual(["./value", "./namespace", "./side-effect", "./reexport"]);
    expect(parseModule(source, "m.ts", { elideTypeImports: true }).elided).toBe(true);
  });

  it("keeps every import when the tsconfig keeps them, in JavaScript, TSX, or a source Node cannot strip", async () => {
    await parserReady;
    const source = lines('import { A } from "./a";', "let a: A;");
    expect(parse(source, "m.ts", false)).toEqual(["./a"]);
    expect(parse(source, "m.js")).toEqual(["./a"]);
    expect(parse(source, "m.tsx")).toEqual(["./a"]);
    expect(parse(`${source}enum E { a }\n`)).toEqual(["./a"]);
    expect(parse(source, "m.mts")).toEqual([]);
  });

  it("keeps an import whose binding is a value somewhere: a call, a property read, a shorthand", async () => {
    await parserReady;
    for (const use of ["A();", "A.b.c();", "let x = { A };", "let x: A = A;", "f(A as A);"]) {
      expect(parse(lines('import { A } from "./a";', use)), use).toEqual(["./a"]);
    }
  });

  const CLASSES = {
    "package.json": PACKAGE,
    "src/type-use.ts": "export class A {}\n",
    "src/typeof.ts": "export class D {}\n",
    "src/unused.ts": "export class E {}\n",
    "src/value.ts": "export class G {}\n",
    "src/namespace.ts": "export class H {}\n",
    "src/enum-file.ts": "export class K {}\n",
    "src/strip-fails.ts": lines(
      'import { K } from "./enum-file.ts";',
      "export enum L { a }",
      "let k: K;",
    ),
    "test/a.test.ts": lines(
      'import { test } from "node:test";',
      'import { A } from "../src/type-use.ts";',
      'import { D } from "../src/typeof.ts";',
      'import { E } from "../src/unused.ts";',
      'import { G } from "../src/value.ts";',
      'import * as H from "../src/namespace.ts";',
      'import { L } from "../src/strip-fails.ts";',
      "function f(a: A, d: typeof D): void {}",
      'test("loads", () => { new G(); void H; void L; void f; });',
    ),
  };

  it("never hides a module the run loads, and holds no module it drops", SLOW, async () => {
    const root = tree(CLASSES);
    const closure = modules((await closureOf(root, "test/a.test.ts")).paths);
    const observed = observedClosure(root, root, TSX, "test/a.test.ts");
    // A source Node's stripping rejects keeps its imports: one path too wide, never short.
    expect(closure).toEqual([...observed, "src/enum-file.ts"].sort());
    for (const dropped of ["src/type-use.ts", "src/typeof.ts", "src/unused.ts"]) {
      expect(closure).not.toContain(dropped);
    }
  });

  it("keys the tsconfig, and holds every import once the tsconfig keeps them", SLOW, async () => {
    const root = tree({ ...CLASSES, "tsconfig.json": paths({}) });
    const graph = await createNodeTestGraph({
      root,
      cwd: root,
      argv: TSX,
      testFiles: ["test/a.test.ts"],
    });
    expect(graph.closure("test/a.test.ts").paths).toContain("tsconfig.json");
    writeFileSync(join(root, "tsconfig.json"), paths({ verbatimModuleSyntax: true }));
    graph.invalidate([{ path: "tsconfig.json", kind: "change" }]);
    const closure = modules(graph.closure("test/a.test.ts").paths);
    expect(closure).toContain("src/type-use.ts");
    expect(closure).toEqual(observedClosure(root, root, TSX, "test/a.test.ts"));
  });
});

describe("b3: require in code only", () => {
  it("names no require in a string or a comment", async () => {
    await parserReady;
    const source = lines(
      "const fixture = \"require('./word.cjs')\";",
      "// require('./commented.cjs')",
      "const real = require('./real.cjs');",
    );
    expect(parseModule(source, "m.cjs").specifiers).toEqual([
      { specifier: "./real.cjs", kind: "require" },
    ]);
  });

  it("adds no absent candidate for one", SLOW, async () => {
    const root = tree({
      "package.json": PACKAGE,
      "test/a.test.cjs": lines(
        'const { test } = require("node:test");',
        'test("text", () => void "require(\'./word.cjs\')");',
      ),
    });
    const closure = await closureOf(root, "test/a.test.cjs", []);
    expect(closure.paths.filter((p) => p.includes("word"))).toEqual([]);
    expect(modules(closure.paths)).toEqual(observedClosure(root, root, [], "test/a.test.cjs"));
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
