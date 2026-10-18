import { realpathSync } from "node:fs";
import type { AbsolutePath, RunnerAdapter } from "../../core/types/index.js";
import { VitestAdapter } from "./adapter.js";
import { loadVitest } from "./load.js";
import { WorktreePaths } from "./paths.js";

export { VITEST_ADAPTER_VERSION } from "./version.js";

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
  /**
   * The width of a run without a grant (`RunOptions.workers`): the slow
   * tier's instance takes policy `slow.maxWorkers` (spec 004 D2). Like a
   * grant, at least 2 and never above the project's own `maxWorkers` (001
   * D11 Capacity, task 001-378). Absent: the config's own.
   */
  readonly maxWorkers?: number;
  /**
   * Told at each start the projects whose config turns Vite's dependency
   * optimizer on, none included, so the registration header names only what
   * the newest config does (D4, task 001-181). Dropped when absent.
   */
  readonly optimizer?: (projects: readonly string[]) => void;
  /**
   * Policy `vitest.excludeProjects`, read at each start: Vitest projects the
   * instance never creates, a name no project has noted once (D11, task
   * 001-349). A revision that moves it recreates the instance. Absent: none.
   */
  readonly excludeProjects?: () => readonly string[];
  /**
   * Policy `vitest.exclude`, read at each listing: test-file globs from the
   * worktree root that Squeal never lists, runs, keys or counts (spec 004
   * D7, task 004-81). Absent: none.
   */
  readonly exclude?: () => readonly string[];
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
    options.maxWorkers,
    options.optimizer,
    options.excludeProjects,
    options.exclude,
  );
  await adapter.open();
  return adapter;
}
