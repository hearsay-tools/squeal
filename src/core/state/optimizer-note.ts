/*
 * Spec 001 D4 (task 001-176): Squeal runs every Vitest instance without the
 * dependency optimizer. A config that turns it on gets one note saying so,
 * in status and in the registration header. No imports: the Vitest adapter
 * writes it, the header finds it among the persisted notes.
 */

/** How the note begins, so the header finds it. */
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
