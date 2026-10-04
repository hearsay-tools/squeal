import { realpathSync } from "node:fs";
import type { AbsolutePath, RunnerAdapter } from "../../core/types/index.js";
import { VitestAdapter } from "./adapter.js";
import { WorktreePaths } from "./paths.js";

export { VITEST_ADAPTER_VERSION } from "./adapter.js";

export interface VitestAdapterOptions {
  /** Worktree root. Spec 001 D4: one Vitest instance per worktree. */
  readonly root: AbsolutePath;
}

/**
 * Vitest runner adapter over `vitest/node` (spec 001 D4). Starts the Vitest
 * instance before resolving, so a broken config rejects here.
 */
export async function createVitestAdapter(options: VitestAdapterOptions): Promise<RunnerAdapter> {
  const adapter = new VitestAdapter(new WorktreePaths(realpathSync(options.root)));
  await adapter.open();
  return adapter;
}
