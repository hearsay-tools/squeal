import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { PackageImport, RunnerPackages } from "../../../src/core/types/index.js";
import { createNodeTestGraph } from "../../../src/runners/node-test/graph/index.js";

/**
 * Task 003-22: the graph reports, per closure, the installed packages and
 * builtins its project files import in one hop, in 001-105's form; a load
 * no specifier names reports `module`, which keys by the whole fingerprint.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-node-test-packages-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const pkg = (name: string, extra: Record<string, unknown> = {}) =>
  `${JSON.stringify({ name, version: "1.0.0", main: "index.js", ...extra })}\n`;

const FILES: Readonly<Record<string, string>> = {
  "package.json": `${JSON.stringify({ name: "app", private: true, type: "module" })}\n`,
  "tsconfig.json": `${JSON.stringify({ compilerOptions: { paths: { "@app/*": ["./lib/*"], vendored: ["./vendor/node_modules/ext/index.js"] } } })}\n`,
  "node_modules/ext/package.json": pkg("ext"),
  "node_modules/ext/index.js": "export const ext = 1;\n",
  "node_modules/ext/sub.js": "export const sub = 1;\n",
  "node_modules/@s/p/package.json": pkg("@s/p"),
  "node_modules/@s/p/x.js": "export const x = 1;\n",
  "node_modules/deep/package.json": pkg("deep"),
  "node_modules/deep/index.js": "export const deep = 1;\n",
  "node_modules/setup-pkg/package.json": pkg("setup-pkg"),
  "node_modules/setup-pkg/index.js": "export const setup = 1;\n",
  "node_modules/types-only/package.json": pkg("types-only"),
  "node_modules/@s/p/node_modules/q/package.json": pkg("q"),
  "node_modules/@s/p/node_modules/q/index.js": "export const q = 1;\n",
  "node_modules/.bin/tool.js": "export const tool = 1;\n",
  "vendor/node_modules/ext/package.json": pkg("ext"),
  "vendor/node_modules/ext/index.js": "export const ext = 1;\n",
  "packages/ws/package.json": pkg("ws"),
  "packages/ws/index.js": "export const ws = 1;\n",
  "lib/helper.ts": `import { deep } from "deep";\nexport const helper = deep;\n`,
  "lib/alias.ts": "export const alias = 1;\n",
  "test/plain.test.ts": `import { test } from "node:test";\nimport { helper } from "../lib/helper.ts";\n`,
  "test/forms.test.ts": [
    `import { readFile } from "node:fs/promises";`,
    `import path from "path";`,
    `import { ext } from "ext";`,
    `import { sub } from "ext/sub.js";`,
    `import { x } from "@s/p/x.js";`,
    `import manifest from "ext/package.json" with { type: "json" };`,
    `import type { T } from "types-only";`,
    `import { ws } from "ws";`,
    `import { alias } from "@app/alias.ts";`,
    `import { missing } from "not-installed";`,
    "",
  ].join("\n"),
  "test/installed.test.ts": [
    `import { ext } from "vendored";`,
    `import { q } from "../node_modules/@s/p/node_modules/q/index.js";`,
    `import { tool } from "../node_modules/.bin/tool.js";`,
    `import manifest from "../node_modules/ext/package.json" with { type: "json" };`,
    "",
  ].join("\n"),
  "test/computed.test.ts": "const name = 'ext';\nawait import(name);\n",
  "test/resolve.test.ts": 'import.meta.resolve("ext");\n',
  "test/relative.test.ts": 'require.resolve("./data.json");\n',
  "test/required.test.ts": 'require.resolve("ext");\n',
  "scripts/setup.ts": `import { setup } from "setup-pkg";\nimport "node:assert";\n`,
};

function repo(): string {
  const dir = join(scratch, `r${Math.random().toString(36).slice(2)}`);
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  // A workspace link: its files are project files of the closure, not an installed package.
  symlinkSync("../packages/ws", join(dir, "node_modules/ws"));
  return dir;
}

const TESTS = [
  "test/computed.test.ts",
  "test/forms.test.ts",
  "test/installed.test.ts",
  "test/plain.test.ts",
  "test/relative.test.ts",
  "test/required.test.ts",
  "test/resolve.test.ts",
];

const order = (entries: readonly PackageImport[]) => {
  const keyed = new Map(entries.map((e) => [`${e.from}>${e.name}${e.manifest ? "#" : ""}`, e]));
  return [...keyed.keys()].sort().map((key) => keyed.get(key));
};

const sorted = (packages: RunnerPackages) => ({
  imports: order(packages.imports),
  builtins: packages.builtins,
  ...(packages.runner === undefined ? {} : { runner: order(packages.runner) }),
});

async function open(argv: readonly string[] = ["--import", "tsx"]) {
  const root = repo();
  return createNodeTestGraph({ root, cwd: root, argv, testFiles: TESTS });
}

describe("node-test graph: first-hop packages (003-22)", () => {
  // Task 003-33: a resolved package is looked up from the directory holding its `node_modules`.
  it("reports each resolved package from its install, an unresolved one from its importer, builtins by name", async () => {
    const graph = await open();
    expect(sorted(graph.packages("test/forms.test.ts"))).toEqual({
      imports: [
        { from: "", name: "@s/p" },
        { from: "", name: "ext" },
        { from: "", manifest: true, name: "ext" },
        { from: "test", name: "not-installed" },
      ],
      builtins: ["fs", "path"],
    });
  });

  // Review wave-3 B1: the package comes from the resolved path, whatever specifier reached it. A
  // tsconfig alias to `vendor/node_modules/ext` is looked up from `vendor`, not as `vendored`; a
  // file under `node_modules` in no package (`.bin`) reports `module`.
  it("reports the package of each installed file a specifier resolves to", async () => {
    const graph = await open();
    expect(sorted(graph.packages("test/installed.test.ts"))).toEqual({
      imports: [
        { from: "", manifest: true, name: "ext" },
        { from: "node_modules/@s/p", name: "q" },
        { from: "vendor", name: "ext" },
      ],
      builtins: ["module"],
    });
  });

  it("reports the packages of every project module in the closure", async () => {
    const graph = await open();
    expect(sorted(graph.packages("test/plain.test.ts"))).toEqual({
      imports: [{ from: "", name: "deep" }],
      builtins: ["test"],
    });
  });

  it("reports module for a load no specifier names", async () => {
    const graph = await open();
    for (const file of ["test/computed.test.ts", "test/resolve.test.ts", "test/required.test.ts"]) {
      expect(graph.packages(file).builtins, file).toContain("module");
    }
    expect(graph.packages("test/relative.test.ts").builtins).toEqual([]);
  });

  it("reports the preloads' packages and the loader chain's as the runner's", async () => {
    const graph = await open([
      "--import",
      "./scripts/setup.ts",
      "--require",
      "setup-pkg",
      "--loader",
      "@s/p/x.js",
      "--import",
      "tsx",
    ]);
    const runner = [
      { from: "", name: "@s/p" },
      { from: "", name: "setup-pkg" },
      { from: "", name: "tsx" },
    ];
    expect(sorted(graph.environmentPackages())).toEqual({
      imports: [
        { from: "", name: "@s/p" },
        { from: "", name: "setup-pkg" },
        { from: "", name: "tsx" },
      ],
      builtins: ["assert"],
      runner,
    });
  });

  it("reports module for a loader given as a path, whose imports the graph does not read", async () => {
    const graph = await open(["--loader", "./loaders/hooks.mjs"]);
    expect(graph.environmentPackages()).toEqual({ imports: [], builtins: ["module"], runner: [] });
  });

  it("follows an edit that changes only a module's packages", async () => {
    const root = repo();
    const graph = await createNodeTestGraph({
      root,
      cwd: root,
      argv: ["--import", "tsx"],
      testFiles: TESTS,
    });
    writeFileSync(join(root, "lib/helper.ts"), `import "ext";\nexport const helper = 1;\n`);
    graph.invalidate([{ path: "lib/helper.ts", kind: "change" }]);
    expect(sorted(graph.packages("test/plain.test.ts"))).toEqual({
      imports: [{ from: "", name: "ext" }],
      builtins: ["test"],
    });
  });
});
