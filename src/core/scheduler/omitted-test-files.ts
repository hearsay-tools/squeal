import { type Store, type TestFileRef, type WorktreeId, worktreeMetaKey } from "../types/index.js";
import type { SchedulerContext } from "./context.js";
import type { RunnerPartBound } from "./runner-work-bound.js";

/*
 * Spec 005 D8 step 3, task 005-26: how many test files the worktree's last
 * successful listing left out because Squeal does not run them (Vitest's
 * typecheck files). A Vitest command the hook would answer for runs them
 * too, so it is answered only while this is zero. A failed listing keeps the
 * row, as it keeps the list; a daemon that wrote none leaves it absent.
 */

/** `meta` key of a worktree's left-out count. */
export function omittedTestFilesMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("omittedTestFiles", worktreeId);
}

/** The count the last listing recorded; `null` when none did or the row is unreadable. */
export function readOmittedTestFiles(store: Store, worktreeId: WorktreeId): number | null {
  const raw = store.meta.get(omittedTestFilesMetaKey(worktreeId));
  const count = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

/** `runner.testFiles()` within `bound`, recording what the listing left out once it answers. */
export async function listTestFilesOf(
  context: Pick<SchedulerContext, "runner" | "store" | "worktreeId">,
  bound: RunnerPartBound,
): Promise<readonly TestFileRef[]> {
  const { runner, store, worktreeId } = context;
  const listed = await bound.call(() => runner.testFiles());
  store.meta.set(omittedTestFilesMetaKey(worktreeId), String(runner.omittedTestFiles?.() ?? 0));
  return listed;
}
