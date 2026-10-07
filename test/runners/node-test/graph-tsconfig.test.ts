import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createNodeTestGraph } from "../../../src/runners/node-test/graph/index.js";
import { readLoaderChain } from "../../../src/runners/node-test/graph/loader-chain.js";
import { createResolver } from "../../../src/runners/node-test/graph/resolver.js";
import { parseJsonc, readTsconfigPaths } from "../../../src/runners/node-test/graph/tsconfig.js";

/**
 * Spec 003 D3 as amended: the tsconfig `extends` chain (S1) and the module
 * format tsx gives an importer (S2), in the shapes the monorepo fixture does
 * not hold; and the note for a preload that may register hooks (S3).
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-node-test-tsconfig-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let count = 0;
function tree(files: Record<string, string>): string {
  const root = join(scratch, `t${count++}`);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const read = (path: string) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

describe("node-test graph: the tsconfig extends chain (S1)", () => {
  it("names the config defining paths and every config read", () => {
    const root = tree({
      "tsconfig.base.json": '{ "compilerOptions": { "paths": { "~/*": ["./src/*"] } } }',
      "app/tsconfig.json": '{ "extends": "../tsconfig.base" }',
    });
    expect(readTsconfigPaths(join(root, "app/tsconfig.json"), read)).toEqual({
      pathsFile: join(root, "tsconfig.base.json"),
      baseUrl: null,
      files: [join(root, "app/tsconfig.json"), join(root, "tsconfig.base.json")],
    });
  });

  it("rebases an inherited baseUrl onto the file that defines it; own options win", () => {
    const root = tree({
      "base.json": '{ "compilerOptions": { "baseUrl": "./lib", "paths": { "a": ["a"] } } }',
      "app/tsconfig.json": '{ "extends": "../base.json", "compilerOptions": { "paths": {} } }',
    });
    expect(readTsconfigPaths(join(root, "app/tsconfig.json"), read)).toMatchObject({
      pathsFile: join(root, "app/tsconfig.json"),
      baseUrl: join(root, "lib"),
    });
  });

  it("merges an extends array in order and finds a package config under node_modules", () => {
    const root = tree({
      "node_modules/@x/config/tsconfig.json": '{ "compilerOptions": { "baseUrl": "." } }',
      "first.json": '{ "compilerOptions": { "paths": { "a": ["a"] } } }',
      "second.json": '{ "compilerOptions": { "paths": { "b": ["b"] } } }',
      "tsconfig.json": '{ "extends": ["@x/config", "./first.json", "./second.json"] }',
    });
    expect(readTsconfigPaths(join(root, "tsconfig.json"), read)).toEqual({
      pathsFile: join(root, "second.json"),
      baseUrl: join(root, "node_modules/@x/config"),
      files: [
        join(root, "tsconfig.json"),
        join(root, "node_modules/@x/config/tsconfig.json"),
        join(root, "first.json"),
        join(root, "second.json"),
      ],
    });
  });

  it("survives a cycle and a missing base", () => {
    const root = tree({
      "a.json": '{ "extends": ["./b.json", "./missing.json"] }',
      "b.json": '{ "extends": "./a.json", "compilerOptions": { "paths": {} } }',
    });
    expect(readTsconfigPaths(join(root, "a.json"), read)).toMatchObject({
      pathsFile: join(root, "b.json"),
      baseUrl: null,
    });
  });

  it("reads comments and trailing commas, keeping slashes inside strings", () => {
    expect(parseJsonc('{\n  // line\n  "a": "x//y", /* block */ "b": [1, 2,],\n}\n')).toEqual({
      a: "x//y",
      b: [1, 2],
    });
    expect(parseJsonc("{ nope")).toBeNull();
  });

  it("resolves a bare specifier against an explicit baseUrl, as tsx does", async () => {
    const root = tree({
      "package.json": '{ "type": "module" }',
      "tsconfig.base.json": '{ "compilerOptions": { "baseUrl": "./src" } }',
      "tsconfig.json": '{ "extends": "./tsconfig.base.json" }',
      "src/util/x.ts": "export const x = 1;\n",
      "test/a.test.ts": 'import { x } from "util/x";\n',
    });
    const graph = await createNodeTestGraph({
      root,
      cwd: root,
      argv: ["--import", "tsx"],
      testFiles: ["test/a.test.ts"],
    });
    expect(graph.closure("test/a.test.ts").paths).toContain("src/util/x.ts");
  });
});

describe("node-test graph: the module format tsx gives an importer (S2)", () => {
  it("follows the extension first, then the nearest package.json type", () => {
    const root = tree({
      "package.json": '{ "type": "module" }',
      "cjs/package.json": '{ "name": "cjs" }',
      "cjs/deep/a.ts": "",
    });
    const resolver = createResolver(readLoaderChain(["--import", "tsx"]), root);
    expect(resolver.moduleFormat(join(root, "cjs/deep/a.ts"))).toEqual({
      format: "commonjs",
      manifest: join(root, "cjs/package.json"),
    });
    expect(resolver.moduleFormat(join(root, "cjs/deep/a.mts")).format).toBe("module");
    expect(resolver.moduleFormat(join(root, "b.cts")).format).toBe("commonjs");
    expect(resolver.moduleFormat(join(root, "b.tsx"))).toEqual({
      format: "module",
      manifest: join(root, "package.json"),
    });
  });
});

describe("node-test graph: a preload that may register hooks (S3)", () => {
  it("notes a worktree preload importing node:module", async () => {
    const root = tree({
      "package.json": '{ "type": "module" }',
      "loader.mjs": 'import { registerHooks } from "node:module";\nregisterHooks({});\n',
      "test/a.test.ts": "",
    });
    const graph = await createNodeTestGraph({
      root,
      cwd: root,
      argv: ["--import", "./loader.mjs", "--import", "tsx"],
      testFiles: ["test/a.test.ts"],
    });
    expect(graph.preloads().paths).toContain("loader.mjs");
    expect(graph.notes()).toEqual([
      expect.stringContaining('preload "loader.mjs" imports node:module and may register'),
    ]);
  });
});
