import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseAst } from "vitest/node";
import { WorktreePaths } from "../../../src/core/fs/worktree-paths.js";
import {
  importsTargets,
  moduleResolutionInputs,
  moduleSpecifiers,
  nearestManifests,
} from "../../../src/runners/vitest/resolution-inputs.js";

/*
 * Row 023-14 (`023 research/glob-membership.md` 3, S7; reviews/wave-4.md B1,
 * B2): the `package.json` files a module's `#` or workspace import reads,
 * found from the specifiers of its syntax tree and its import targets, join
 * the closure. An installed package's do not.
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * A worktree with `files`, a workspace package `@w/shared` linked into
 * `node_modules`, and an installed package `dep` (pnpm's layout).
 */
function workspace(files: Record<string, string>): string {
  const root = worktree({
    "packages/shared/package.json": JSON.stringify({ name: "@w/shared", main: "src/index.ts" }),
    "packages/shared/src/index.ts": "",
    "node_modules/.pnpm/dep/node_modules/dep/package.json": "{}",
    ...files,
  });
  mkdirSync(join(root, "node_modules/@w"), { recursive: true });
  symlinkSync(join(root, "packages/shared"), join(root, "node_modules/@w/shared"));
  symlinkSync(
    join(root, "node_modules/.pnpm/dep/node_modules/dep"),
    join(root, "node_modules/dep"),
  );
  return root;
}

/** A worktree under `$TMPDIR` with `files` written. */
function worktree(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "resolution-inputs-")));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe("a module's import specifiers (row 023-14)", () => {
  it("reads # and bare value imports, re-exports and literal import(); types, builtins, relative ones, comments and strings give none", async () => {
    const source = [
      'import type { A } from "./types.js";',
      'import { b } from "./b";',
      'export * from "#x";',
      'import "#y/deep?raw";',
      'export type { D } from "./d.js";',
      'import type { T } from "type-only";',
      'export { e } from "@s/pkg/sub";',
      'import { readFileSync } from "node:fs";',
      'import "vitest";',
      'const m = await import("../m.js?raw");',
      'const p = await import("pkg?url");',
      '// import "./comment";',
      "const s = \"import './string'\";",
    ].join("\n");
    expect(await moduleSpecifiers("/w/src/x.ts", source, parseAst)).toEqual({
      subpaths: ["#x", "#y/deep"],
      bare: ["@s/pkg/sub", "vitest", "pkg"],
    });
  });

  it("gives null for a module the parser cannot read", async () => {
    expect(await moduleSpecifiers("/w/src/x.ts", "import {", parseAst)).toBeNull();
    expect(await moduleSpecifiers("/w/src/x.vue", 'import "./a";', parseAst)).toBeNull();
  });
});

describe("the manifests a module's imports read (row 023-14)", () => {
  it("finds the nearest package.json up to the root, with the absent ones before it", () => {
    const root = worktree({ "package.json": "{}", "src/deep/x.ts": "" });
    expect(nearestManifests(join(root, "src/deep"), root)).toEqual([
      join(root, "src/deep/package.json"),
      join(root, "src/package.json"),
      join(root, "package.json"),
    ]);
  });

  it("a # import keys the manifest whose imports it reads; a relative one keys none", async () => {
    const root = worktree({
      "package.json": JSON.stringify({ imports: { "#reg": "./src/reg-a.ts" } }),
      "src/reg-a.ts": "",
      "src/registry.ts": "",
      "test/a.test.ts": 'import { value } from "#reg";\n',
      "test/b.test.ts": 'import { count } from "../src/registry";\n',
    });
    const inputs = (file: string) =>
      moduleResolutionInputs(join(root, file), [], new WorktreePaths(root), parseAst);
    expect(await inputs("test/a.test.ts")).toEqual([
      join(root, "test/package.json"),
      join(root, "package.json"),
    ]);
    expect(await inputs("test/b.test.ts")).toEqual([]);
  });

  it("a bare import keys a workspace link's manifest and the module's own package by name, not an installed one", async () => {
    const root = workspace({
      "package.json": JSON.stringify({ name: "self", exports: { "./sub": "./src/sub.ts" } }),
      "src/x.ts": 'import "@w/shared";\nimport "self/sub";\nimport "dep";\n',
    });
    const inputs = await moduleResolutionInputs(
      join(root, "src/x.ts"),
      [],
      new WorktreePaths(root),
      parseAst,
    );
    expect(inputs.sort()).toEqual(
      [
        join(root, "packages/shared/package.json"),
        // The own package is found as the nearest manifest: one added here would take its place.
        join(root, "src/package.json"),
        join(root, "package.json"),
      ].sort(),
    );
  });

  // Reviews/wave-4.md B1: `#chosen` maps to a workspace package, whose `exports` picks the file.
  it("a # import whose entry names a workspace package keys that package's manifest", async () => {
    const root = workspace({
      "package.json": JSON.stringify({ imports: { "#chosen": "@w/shared", "#rel": "./a.ts" } }),
      "test/a.test.ts": 'import { value } from "#chosen";\nimport "#rel";\n',
    });
    const target = join(root, "packages/shared/src/index.ts");
    const inputs = await moduleResolutionInputs(
      join(root, "test/a.test.ts"),
      [target],
      new WorktreePaths(root),
      parseAst,
    );
    expect(inputs.sort()).toEqual(
      [
        join(root, "test/package.json"),
        join(root, "package.json"),
        join(root, "packages/shared/src/package.json"),
        join(root, "packages/shared/package.json"),
      ].sort(),
    );
  });

  // Reviews/wave-4.md B2: `@w/shared/sub` picks its file through `sub/package.json`'s `main`.
  it("a workspace subpath keys the manifest of its folder, present or absent, up to the package's", async () => {
    const root = workspace({
      "packages/shared/sub/package.json": JSON.stringify({ main: "./a.ts" }),
      "packages/shared/sub/a.ts": "",
      "packages/shared/other/index.ts": "",
      "src/x.ts": 'import "@w/shared/sub";\nimport "@w/shared/other";\n',
    });
    const shared = join(root, "packages/shared");
    const inputs = await moduleResolutionInputs(
      join(root, "src/x.ts"),
      [join(shared, "sub/a.ts"), join(shared, "other/index.ts"), join(root, "src/y.ts")],
      new WorktreePaths(root),
      parseAst,
    );
    expect(inputs.sort()).toEqual(
      [
        join(shared, "package.json"),
        join(shared, "sub/package.json"),
        join(shared, "other/package.json"),
      ].sort(),
    );
  });

  it("a package with exports keys only its own manifest, not the folders below it", async () => {
    const root = workspace({
      "packages/shared/package.json": JSON.stringify({
        name: "@w/shared",
        exports: { "./*": "./src/*.ts" },
      }),
      "packages/shared/src/sub.ts": "",
      "src/x.ts": 'import "@w/shared/sub";\n',
    });
    const inputs = await moduleResolutionInputs(
      join(root, "src/x.ts"),
      [join(root, "packages/shared/src/sub.ts")],
      new WorktreePaths(root),
      parseAst,
    );
    expect(inputs).toEqual([join(root, "packages/shared/package.json")]);
  });
});

describe("the targets an imports field gives a # specifier (row 023-14)", () => {
  it("reads an exact key and a pattern, under every condition, and nothing else", () => {
    const imports = {
      "#a": { node: "@w/shared", default: ["./a.ts", { import: "./a.mjs" }] },
      "#p/*.js": "./src/*.ts",
      "#p/*": null,
      "#other": "./other.ts",
    };
    expect(importsTargets(imports, "#a")).toEqual(["@w/shared", "./a.ts", "./a.mjs"]);
    expect(importsTargets(imports, "#p/deep/x.js")).toEqual(["./src/deep/x.ts"]);
    expect(importsTargets(imports, "#none")).toEqual([]);
    expect(importsTargets(undefined, "#a")).toEqual([]);
  });
});
