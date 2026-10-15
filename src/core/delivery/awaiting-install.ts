/** Workspaces the wait sentence names before the rest is counted (task 001-107). */
const MISSING_INSTALLS_SHOWN = 3;

/**
 * Spec 001 D5 as amended (tasks 001-100, 001-107, 001-410): the sentence a
 * header shows while the daemon waits for an install. It names the
 * workspaces still missing theirs when others have one (review wave 11,
 * N2), the command that installs them (`installCommand`) and what that
 * gains. "The results", not "every result": an inherited fail stands only
 * once confirmed (D6). Without a command, from a daemon before 001-410, it
 * says only "Install them".
 */
export function awaitingInstallSentence(
  missing: readonly string[],
  command: string | undefined,
): string {
  const more = missing.length - MISSING_INSTALLS_SHOWN;
  const where =
    missing.length === 0
      ? "in this worktree"
      : `at this worktree's root or in ${missing.slice(0, MISSING_INSTALLS_SHOWN).join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
  const install = command === undefined ? "Install them" : `Run \`${command}\` to install them`;
  return (
    `No dependencies are installed ${where}, so Squeal runs none of its tests and inherits none of their results. ` +
    `${install}: Squeal then inherits the results other worktrees recorded for the same code and dependencies, and runs the rest.`
  );
}

/** The scheduler's note at the start of a wait: the header's sentence, as a note reads. */
export function awaitingInstallNote(missing: readonly string[], command: string): string {
  const sentence = awaitingInstallSentence(missing, command);
  return `${sentence.charAt(0).toLowerCase()}${sentence.slice(1, -1)}`;
}
