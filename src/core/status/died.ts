import { existsSync } from "node:fs";
import { acquireDaemonLock } from "../daemon/lock.js";
import { readDaemonNotes } from "../notes.js";
import { testFileLabel } from "../run-log.js";
import { lockFileFor } from "../store/index.js";
import type {
  DaemonDeath,
  DaemonLiveness,
  EpochMs,
  Store,
  WorktreeRecord,
} from "../types/index.js";

/** Test files a death names per run; the rest are counted. */
export const DIED_FILES_SHOWN = 5;

/**
 * Task 001-263 (`research/daemon-sigkill.md`): a daemon killed by its
 * process group, as a hosted test's `kill(0, "SIGKILL")` does, leaves its
 * record with a stale heartbeat and writes no note. `live` with `died` when
 * it is down and the record still names a daemon, which a shutdown clears;
 * no note was written at or after the last heartbeat, since a shutdown stops
 * the heartbeat, then notes why; and its lock is free (`daemonGone`). The
 * runs it left open are those it started.
 */
export function withDeath(
  store: Store,
  worktree: WorktreeRecord | null,
  live: DaemonLiveness,
): DaemonLiveness {
  const record = worktree?.daemon ?? null;
  if (live.state !== "down" || worktree === null || record === null) return live;
  const { id } = worktree;
  if (readDaemonNotes(store, id).some((note) => note.at >= record.heartbeatAt)) return live;
  if (!daemonGone(worktree)) return live;
  const runs = store.runs
    .inFlight(id, record.startedAt)
    .map((run) => ({ id: run.id, revision: run.revision, testFiles: run.testFiles }));
  return { ...live, died: { runs } };
}

/**
 * Whether no process holds the worktree's daemon lock, which the OS releases
 * on any death (D10). A daemon stopped or wedged past its heartbeat still
 * holds it (lessons, defect 22). Taken and released at once, as
 * `waiterLockState` probes a waiter's; no lock file means no daemon of this
 * store ever ran here, so the record proves nothing.
 */
function daemonGone(worktree: WorktreeRecord): boolean {
  const path = lockFileFor(worktree.commonDir, worktree.id);
  if (!existsSync(path)) return false;
  try {
    const lock = acquireDaemonLock(path);
    lock?.release();
    return lock !== null;
  } catch {
    return false;
  }
}

/**
 * "died without shutting down at about <last heartbeat>, during run <id>
 * (revision N) of <files>", or "between runs" with none open.
 */
export function deathText(died: DaemonDeath, since: EpochMs | null): string {
  const at = since === null ? "" : ` at about ${new Date(since).toISOString()}`;
  const during =
    died.runs.length === 0
      ? "between runs"
      : `during ${died.runs
          .map((run) => `run ${run.id} (revision ${run.revision}) of ${files(run.testFiles)}`)
          .join("; ")}`;
  return `died without shutting down${at}, ${during}`;
}

/** Why a daemon dies that way, for whoever reads the death. */
export const DEATH_CAUSE =
  "A SIGKILL, or a test that signals its own process group (`kill(0, ...)`), ends a daemon this way.";

function files(refs: DaemonDeath["runs"][number]["testFiles"]): string {
  const shown = refs.slice(0, DIED_FILES_SHOWN).map((ref) => testFileLabel(ref.project, ref.path));
  const more = refs.length - shown.length;
  return `${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}
