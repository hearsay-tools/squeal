import { notImplemented } from "../../core/not-implemented.js";
import type { AbsolutePath, RunnerAdapter } from "../../core/types/index.js";

export interface VitestAdapterOptions {
  /** Worktree root. Spec 001 D4: one Vitest instance per worktree. */
  readonly root: AbsolutePath;
}

/** Vitest runner adapter over `vitest/node` (spec 001 D4). Task 001-13. */
export function createVitestAdapter(_options: VitestAdapterOptions): Promise<RunnerAdapter> {
  return notImplemented("createVitestAdapter");
}
