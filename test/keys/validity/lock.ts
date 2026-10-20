import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { build } from "esbuild";

/*
 * Risk 9 of task 011-37 (design section 6): a package an entry imports, or
 * the bundler, moved since the last release. Both bundles would then run on
 * the candidate's install and be built by its esbuild, which compares
 * nothing the release shipped. The comparison installs the release's own
 * lock into its extracted tree instead, and bundles and runs that side from
 * there.
 */

/** Installs `tree`'s own lock into it. */
export type Install = (tree: string) => void;

/** `npm ci` of the tree's lock, its scripts off as a candidate tree's install runs here. */
export const installLock: Install = (tree) => {
  execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], {
    cwd: tree,
    stdio: "pipe",
    timeout: 600_000,
  });
};

/** The esbuild `tree` installed. */
export async function esbuildOf(tree: string): Promise<typeof build> {
  const main = pathToFileURL(join(tree, "node_modules/esbuild/lib/main.js")).href;
  return ((await import(main)) as { build: typeof build }).build;
}
