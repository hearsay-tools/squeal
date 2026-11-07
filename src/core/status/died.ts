import { testFileLabel } from "../run-log.js";
import type { DaemonDeath } from "../types/status.js";

/** Test files a death names per run; the rest are counted. */
export const DIED_FILES_SHOWN = 5;

/**
 * "died without shutting down, during run <id> (revision N) of <files>", or
 * "between runs" with none open. Said after the last heartbeat's time, which
 * the down daemon's text already names.
 */
export function deathText(died: DaemonDeath): string {
  const during =
    died.runs.length === 0
      ? "between runs"
      : `during ${died.runs
          .map((run) => `run ${run.id} (revision ${run.revision}) of ${files(run.testFiles)}`)
          .join("; ")}`;
  return `died without shutting down, ${during}`;
}

/** Why a daemon dies that way, for whoever reads the death. */
export const DEATH_CAUSE =
  "A SIGKILL, or a test that signals its own process group (`kill(0, ...)`), ends a daemon this way.";

function files(refs: DaemonDeath["runs"][number]["testFiles"]): string {
  const shown = refs.slice(0, DIED_FILES_SHOWN).map((ref) => testFileLabel(ref.project, ref.path));
  const more = refs.length - shown.length;
  return `${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}
