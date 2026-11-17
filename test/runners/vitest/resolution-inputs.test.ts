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
} from "../../../src/runners/vitest/resolution-inputs.js";

/*
 * Row 023-14 (`023 research/glob-membership.md` 3, S7): the `package.json` a
 * module's `#` or workspace import reads, found from the specifiers of its
 * syntax tree, joins the closure.
 */

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
  it("reads # and bare value imports, re-exports and literal import(); types, builtins, relative ones, comments and strings give none", async () => {
    const source = [
      'import type { A } from "./types.js";',
      'import { b } from "./b";',
      'export * from "#x";',
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
      subpath: true,
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
      moduleResolutionInputs(join(root, file), new WorktreePaths(root), parseAst);
    expect(await inputs("test/a.test.ts")).toEqual([
      join(root, "test/package.json"),
      join(root, "package.json"),
    ]);
    expect(await inputs("test/b.test.ts")).toEqual([]);
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
