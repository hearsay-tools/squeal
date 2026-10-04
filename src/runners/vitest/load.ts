import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AbsolutePath } from "../../core/types/index.js";

/** The `vitest/node` module, typed from Squeal's own Vitest; the value comes from the project. */
export type VitestNode = typeof import("vitest/node");

/**
 * Imports `vitest/node` as the project at `root` resolves it. Spec 001 D11:
 * "Squeal loads Vitest from the project under validation, resolved from the
 * worktree root and imported lazily by the runner adapter, never from its
 * own installation". Review wave 3, B2: a static import resolves from the
 * importing file, which in the plugin's CLI bundle has no `node_modules`
 * above it, and loads for every command.
 *
 * Rejects when the project has no Vitest; the daemon's recovering runner
 * turns that into a runner failure with a note (D5).
 */
export async function loadVitest(root: AbsolutePath): Promise<VitestNode> {
  let resolved: string;
  try {
    resolved = createRequire(join(root, "package.json")).resolve("vitest/node");
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new Error(
      `vitest/node does not resolve from ${root} (${reason}); Squeal runs only the project's own Vitest`,
    );
  }
  return (await import(pathToFileURL(resolved).href)) as VitestNode;
}
