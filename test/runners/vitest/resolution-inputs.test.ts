import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseAst } from "vitest/node";
import { WorktreePaths } from "../../../src/core/fs/worktree-paths.js";
import {
  moduleResolutionInputs,
  moduleSpecifiers,
  nearestManifests,
  shadowsOf,
  viteOrder,
} from "../../../src/runners/vitest/resolution-inputs.js";

/*
 * Row 023-14 (`023 research/glob-membership.md` 3, S7): what decides how a
 * module's imports resolve, read from its syntax tree and Vite 8's
 * `tryCleanFsResolve` order. A path Vite tries before the resolved target, and
 * the `package.json` a `#` or workspace import reads, join the closure.
 */

const EXTENSIONS = [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"];

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

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
  it("reads value imports, re-exports and literal import(), by kind; types, comments and strings give none", async () => {
    const source = [
      'import type { A } from "./types.js";',
      'import { b } from "./b";',
      'export * from "#x";',
      'export type { D } from "./d.js";',
      'export { e } from "@s/pkg/sub";',
      'import { readFileSync } from "node:fs";',
      'import "vitest";',
      'const m = await import("../m.js?raw");',
      '// import "./comment";',
      "const s = \"import './string'\";",
    ].join("\n");
    expect(await moduleSpecifiers("/w/src/x.ts", source, parseAst)).toEqual({
      relative: ["./b", "../m.js"],
      subpath: true,
      bare: ["@s/pkg/sub", "vitest"],
    });
  });

  it("gives null for a module the parser cannot read", async () => {
    expect(await moduleSpecifiers("/w/src/x.ts", "import {", parseAst)).toBeNull();
    expect(await moduleSpecifiers("/w/src/x.vue", 'import "./a";', parseAst)).toBeNull();
  });
});

describe("the paths Vite tries before the resolved one (row 023-14)", () => {
  const order = viteOrder("/w/src/registry", EXTENSIONS);

  it("follows tryCleanFsResolve: the file, each extension, then the folder's package.json and index", () => {
    expect(order.slice(0, 4)).toEqual([
      "/w/src/registry",
      "/w/src/registry.mjs",
      "/w/src/registry.js",
      "/w/src/registry.mts",
    ]);
    expect(order.slice(8, 10)).toEqual([
      "/w/src/registry/package.json",
      "/w/src/registry/index.mjs",
    ]);
    expect(viteOrder("/w/src/a.js", EXTENSIONS).slice(0, 3)).toEqual([
      "/w/src/a.js",
      "/w/src/a.ts",
      "/w/src/a.tsx",
    ]);
  });

  it("keeps what comes before the target: a registry.js shadows registry.ts, a.js its twin a.ts", () => {
    expect(shadowsOf("/w/src/registry", new Set(["/w/src/registry.ts"]), EXTENSIONS)).toEqual([
      "/w/src/registry",
      "/w/src/registry.mjs",
      "/w/src/registry.js",
      "/w/src/registry.mts",
    ]);
    expect(shadowsOf("/w/src/a.js", new Set(["/w/src/a.ts"]), EXTENSIONS)).toEqual(["/w/src/a.js"]);
    expect(shadowsOf("/w/src/a.ts", new Set(["/w/src/a.ts"]), EXTENSIONS)).toEqual([]);
  });

  it("keeps every extension and the folder's package.json before an index", () => {
    const shadows = shadowsOf("/w/src/lib", new Set(["/w/src/lib/index.ts"]), EXTENSIONS);
    expect(shadows).toContain("/w/src/lib.ts");
    expect(shadows).toContain("/w/src/lib.json");
    expect(shadows).toContain("/w/src/lib/package.json");
    expect(shadows).toContain("/w/src/lib/index.js");
    expect(shadows).not.toContain("/w/src/lib/index.ts");
  });

  it("keeps the whole order when no target is in it: a package.json entry, or an unresolved import", () => {
    const shadows = shadowsOf("/w/src/lib", new Set(["/w/src/lib/dist/entry.ts"]), EXTENSIONS);
    expect(shadows).toEqual(viteOrder("/w/src/lib", EXTENSIONS));
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

  it("a # import keys the manifest whose imports it reads; a relative one its shadows", async () => {
    const root = worktree({
      "package.json": JSON.stringify({ imports: { "#reg": "./src/reg-a.ts" } }),
      "src/reg-a.ts": "",
      "src/registry.ts": "",
      "test/a.test.ts": 'import { value } from "#reg";\nimport { count } from "../src/registry";\n',
    });
    const file = join(root, "test/a.test.ts");
    const targets = new Set([join(root, "src/reg-a.ts"), join(root, "src/registry.ts")]);
    const inputs = await moduleResolutionInputs(
      file,
      targets,
      EXTENSIONS,
      new WorktreePaths(root),
      parseAst,
    );
    expect(inputs).toEqual(
      expect.arrayContaining([
        join(root, "test/package.json"),
        join(root, "package.json"),
        join(root, "src/registry.js"),
      ]),
    );
    expect(inputs).not.toContain(join(root, "src/registry.ts"));
  });

  it("a bare import keys a workspace link's manifest and the module's own package by name, not an installed one", async () => {
    const root = worktree({
      "package.json": JSON.stringify({ name: "self", exports: "./src/index.ts" }),
      "packages/shared/package.json": JSON.stringify({ name: "@w/shared", main: "src/index.ts" }),
      "packages/shared/src/index.ts": "",
      "node_modules/.pnpm/dep/node_modules/dep/package.json": "{}",
      "src/x.ts": 'import "@w/shared";\nimport "self/sub";\nimport "dep";\n',
    });
    mkdirSync(join(root, "node_modules/@w"), { recursive: true });
    symlinkSync(join(root, "packages/shared"), join(root, "node_modules/@w/shared"));
    symlinkSync(
      join(root, "node_modules/.pnpm/dep/node_modules/dep"),
      join(root, "node_modules/dep"),
    );
    const inputs = await moduleResolutionInputs(
      join(root, "src/x.ts"),
      new Set(),
      EXTENSIONS,
      new WorktreePaths(root),
      parseAst,
    );
    expect(inputs.sort()).toEqual(
      [
        join(root, "packages/shared/package.json"),
        join(root, "src/package.json"),
        join(root, "package.json"),
      ].sort(),
    );
  });
});
