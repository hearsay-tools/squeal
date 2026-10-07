import { describe, expect, it } from "vitest";
import { WorktreePaths } from "../../../src/core/fs/worktree-paths.js";
import type { ImportClosure } from "../../../src/runners/vitest/graph.js";
import { sourceLoads } from "../../../src/runners/vitest/loads.js";
import { closurePackages } from "../../../src/runners/vitest/packages.js";

const ROOT = "/w";
const paths = new WorktreePaths(ROOT);

const closure = (files: string[], extra: Partial<ImportClosure> = {}): ImportClosure => ({
  files: new Set(files),
  missing: new Set(),
  bare: new Map(),
  builtins: new Set(),
  rooted: new Set(),
  root: ROOT,
  ...extra,
});

describe("closurePackages (001-109)", () => {
  it("sends a file under node_modules in no package, such as Vite's pre-bundled deps, to the fallback (N4)", () => {
    const packages = closurePackages(
      closure(["/w/test/a.test.ts", "/w/node_modules/.vite/deps_ssr/ext.js"]),
      paths,
    );
    expect(packages.imports).toEqual([]);
    expect(packages.builtins).toEqual(["module"]);
  });

  it("looks a package entry up from the directory holding its node_modules", () => {
    const packages = closurePackages(
      closure([
        "/w/node_modules/@s/p/index.js",
        "/w/pkg/node_modules/ext/lib/a.js",
        "/x/node_modules/out/a.js",
      ]),
      paths,
    );
    expect(packages.imports).toEqual([
      { from: "", name: "@s/p" },
      { from: "pkg", name: "ext" },
    ]);
    expect(packages.builtins).toEqual([]);
  });

  it("marks an import of a package's own package.json, which loads no code (N2)", () => {
    const packages = closurePackages(closure(["/w/node_modules/@types/node/package.json"]), paths);
    expect(packages.imports).toEqual([{ from: "", name: "@types/node", manifest: true }]);
  });

  it("looks a docblock's environment up from the project root (B1)", () => {
    const packages = closurePackages(
      closure([], { rooted: new Set(["vitest-environment-custom"]), root: "/w/app" }),
      paths,
    );
    expect(packages.imports).toEqual([{ from: "app", name: "vitest-environment-custom" }]);
  });
});

describe("sourceLoads (001-109, B1, B2)", () => {
  it("reports literal requires, and loads no specifier names", () => {
    expect(sourceLoads("const a = require(\"a\");\nconst b = require( '@s/b/sub' );\n")).toEqual({
      requires: ["a", "@s/b/sub"],
      unnamed: false,
      environment: null,
    });
    for (const source of [
      'require.resolve("x/data.json")',
      'import { createRequire } from "node:module";',
      'import.meta.resolve("tsx")',
      "require(name)",
      "require(`x`)",
      'require("a" + suffix)',
    ]) {
      expect(sourceLoads(source).unnamed, source).toBe(true);
    }
    for (const source of ["myrequire(name)", "const required = 1;", 'import a from "a";']) {
      expect(sourceLoads(source).unnamed, source).toBe(false);
    }
  });

  it("reads the environment a docblock names, as Vitest does", () => {
    // Split, so Vitest does not read these as this file's own docblock.
    const tag = (runner: string) => `@${runner}-environment`;
    expect(sourceLoads(`/**\n * ${tag("vitest")} happy-dom\n */`).environment).toBe("happy-dom");
    expect(sourceLoads(`// ${tag("jest")} custom`).environment).toBe("custom");
    expect(sourceLoads("// no docblock").environment).toBeNull();
  });
});
