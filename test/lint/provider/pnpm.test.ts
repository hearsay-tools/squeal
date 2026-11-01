import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pnpmShimPaths } from "../../../src/core/lint/provider/pnpm.js";

/* Row 017-19: the folders pnpm's bin shim for ESLint puts on `NODE_PATH`. */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function root(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-lint-pnpm-")));
  dirs.push(dir);
  return dir;
}

function eslintAt(dir: string): void {
  mkdirSync(dir, { recursive: true });
  // `package.json` is what tells Node the package is there.
  symlinkSync(
    join(import.meta.dirname, "../../../node_modules/eslint/package.json"),
    join(dir, "package.json"),
  );
}

describe("pnpm's shim folders (row 017-19)", () => {
  it("none for ESLint installed by npm", () => {
    const npm = root();
    eslintAt(join(npm, "node_modules/eslint"));
    expect(pnpmShimPaths(npm)).toEqual([]);
  });

  it("ESLint's own folders, then the hoisted folder, from the node_modules Node finds ESLint in", () => {
    const top = root();
    const store = join(top, "node_modules/.pnpm/eslint@10.13.0/node_modules");
    eslintAt(join(store, "eslint"));
    mkdirSync(join(top, "node_modules/.pnpm/node_modules"));
    symlinkSync(".pnpm/eslint@10.13.0/node_modules/eslint", join(top, "node_modules/eslint"));
    const project = join(top, "packages/app");
    mkdirSync(project, { recursive: true });
    expect(pnpmShimPaths(project)).toEqual([
      join(store, "eslint/node_modules"),
      store,
      join(top, "node_modules/.pnpm/node_modules"),
    ]);
  });

  it("the hoisted folder alone when ESLint is not a link into pnpm's store", () => {
    const top = root();
    eslintAt(join(top, "node_modules/eslint"));
    mkdirSync(join(top, "node_modules/.pnpm/node_modules"), { recursive: true });
    expect(pnpmShimPaths(top)).toEqual([join(top, "node_modules/.pnpm/node_modules")]);
  });
});
