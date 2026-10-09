import type { Store, WorktreeId } from "../types/index.js";

/*
 * Spec 001 D4 (task 001-176): Squeal runs every Vitest instance without the
 * dependency optimizer. A config that turns it on gets one note saying so,
 * in status and in the registration header. Status lists it among the dated
 * daemon notes; the header names only what the newest instance's config
 * turns on (review wave-13h S1, task 001-181), recorded at each start under
 * `optimizerOffMetaKey` and cleared by a start whose config turns it on
 * nowhere.
 */

/** How the note begins. */
export const OPTIMIZER_OFF_NOTE = "Squeal runs Vitest without its dependency optimizer";

/** The note for `projects`, the names of those whose config turns the optimizer on. */
export function optimizerOffNote(projects: readonly string[]): string {
  const named = projects.map((name) => (name === "" ? "the root project" : name)).join(", ");
  return (
    `${OPTIMIZER_OFF_NOTE}, which the config of ${named} turns on: its bundles hold ` +
    "source bytes no key names, so a result could come from bytes other than those on disk " +
    "(spec 001 D4, task 001-176)"
  );
}

/** `meta` key of the note for the newest Vitest instance's config; empty when it turns nothing on. */
export function optimizerOffMetaKey(worktreeId: WorktreeId): string {
  return `optimizer-off.${worktreeId}`;
}

/** Records what the config of the instance just started turns on: `projects`, maybe none. */
export function recordOptimizerOff(
  store: Store,
  worktreeId: WorktreeId,
  projects: readonly string[],
): void {
  store.meta.set(
    optimizerOffMetaKey(worktreeId),
    projects.length === 0 ? "" : optimizerOffNote(projects),
  );
}

/** The note for the newest instance's config, or `undefined` when it turns nothing on. */
export function readOptimizerOff(store: Store, worktreeId: WorktreeId): string | undefined {
  const text = store.meta.get(optimizerOffMetaKey(worktreeId));
  return text === null || text === "" ? undefined : text;
}
