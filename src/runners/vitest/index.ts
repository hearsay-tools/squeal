import { realpathSync } from "node:fs";
import type { AbsolutePath, RunnerAdapter } from "../../core/types/index.js";
import { VitestAdapter } from "./adapter.js";
import { loadVitest } from "./load.js";
import { WorktreePaths } from "./paths.js";

export { VITEST_ADAPTER_VERSION } from "./adapter.js";

export interface VitestAdapterOptions {
  /** Worktree root. Spec 001 D4: one Vitest instance per worktree. */
  readonly root: AbsolutePath;
  /**
   * Records a fact the adapter worked around as a status note (D7): the
   * fallback to full invalidation, a broken instance it recreates. Dropped
   * when absent.
   */
  readonly note?: (text: string) => void;
  /**
   * Policy `observe.runtimeInputs`, read before each call: the workers carry
   * the runtime-input recorder (D4, task 001-132). Absent: nothing observed.
   */
  readonly observe?: () => boolean;
  /**
   * Added to every worker's env and left out of the environment hash: the
   * daemon's marker for the processes tests leave behind (D12, task 001-142).
   */
  readonly childEnv?: Readonly<Record<string, string>>;
}

/**
 * Vitest runner adapter over the project's `vitest/node` (spec 001 D4, D11).
 * Starts the Vitest instance before resolving, so a missing Vitest or a
 * broken config rejects here.
 */
export async function createVitestAdapter(options: VitestAdapterOptions): Promise<RunnerAdapter> {
  const root = realpathSync(options.root);
  const adapter = new VitestAdapter(
    new WorktreePaths(root),
    await loadVitest(root),
    options.note,
    options.observe,
    options.childEnv,
  );
  await adapter.open();
  return adapter;
}
