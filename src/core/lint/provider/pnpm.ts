import { existsSync, readlinkSync } from "node:fs";
import Module from "node:module";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import type { AbsolutePath } from "../../types/common.js";

/*
 * Row 017-19 (`lessons.md` L1): pnpm's bin shim for ESLint puts ESLint's
 * own folders and pnpm's hoisted folder, `node_modules/.pnpm/node_modules`,
 * on `NODE_PATH`, so a CommonJS config can require a package it does not
 * declare. The worker sets the same path before it loads the config. An
 * ES module config ignores `NODE_PATH`, under the shim too.
 */

/**
 * The folders pnpm's shim for the ESLint at `root` puts first on
 * `NODE_PATH`, in its order; none when pnpm did not install that ESLint.
 */
export function pnpmShimPaths(root: AbsolutePath): AbsolutePath[] {
  const modules = modulesOf(root);
  if (modules === null) return [];
  const hoisted = join(modules, ".pnpm", "node_modules");
  if (!existsSync(hoisted)) return [];
  let target: string;
  try {
    target = resolve(modules, readlinkSync(join(modules, "eslint")));
  } catch {
    return [hoisted];
  }
  const store = join(modules, ".pnpm") + sep;
  return target.startsWith(store)
    ? [join(target, "node_modules"), dirname(target), hoisted]
    : [hoisted];
}

/**
 * `paths` first on this thread's `NODE_PATH`, as the shim sets it: before
 * any the daemon gave. The CommonJS loader reads it again.
 */
export function useNodePath(paths: readonly AbsolutePath[]): void {
  if (paths.length === 0) return;
  const given = process.env.NODE_PATH;
  process.env.NODE_PATH = [...paths, ...(given ? [given] : [])].join(delimiter);
  (Module as unknown as { _initPaths(): void })._initPaths();
}

/** The `node_modules` folder Node finds ESLint in from `root`, as it looks up. */
function modulesOf(root: AbsolutePath): AbsolutePath | null {
  for (let dir = root; ; dir = dirname(dir)) {
    const modules = join(dir, "node_modules");
    if (existsSync(join(modules, "eslint", "package.json"))) return modules;
    if (dirname(dir) === dir) return null;
  }
}
