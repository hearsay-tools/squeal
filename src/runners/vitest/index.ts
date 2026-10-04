import { realpathSync } from "node:fs";
import type { AbsolutePath, RunnerAdapter } from "../../core/types/index.js";
import { VitestAdapter } from "./adapter.js";
import { loadVitest } from "./load.js";
import { WorktreePaths } from "./paths.js";

export { VITEST_ADAPTER_VERSION } from "./adapter.js";

export interface VitestAdapterOptions {
  /** Worktree root. Spec 001 D4: one Vitest instance per worktree. */
  readonly root: AbsolutePath;
}

/**
 * Vitest runner adapter over the project's `vitest/node` (spec 001 D4, D11).
 * Starts the Vitest instance before resolving, so a missing Vitest or a
 * broken config rejects here.
 */
export async function createVitestAdapter(options: VitestAdapterOptions): Promise<RunnerAdapter> {
  const root = realpathSync(options.root);
  const adapter = new VitestAdapter(new WorktreePaths(root), await loadVitest(root));
  await adapter.open();
  return adapter;
}
