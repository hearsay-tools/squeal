import { existsSync } from "node:fs";
import { acquireDaemonLock } from "../daemon/lock.js";
import { daemonStart } from "../daemon/start-mark.js";
import { readDaemonNotes } from "../notes.js";
import { testFileLabel } from "../run-log.js";
import { lockFileFor } from "../store/index.js";
import {
  type DaemonDeath,
  type DaemonLiveness,
  daemonExitMetaKey,
  daemonIncarnation,
  type EpochMs,
  type Store,
  type WorktreeId,
  type WorktreeRecord,
} from "../types/index.js";

/** Test files a death names per run; the rest are counted. */
export const DIED_FILES_SHOWN = 5;

/**
 * Task 001-263 (`research/daemon-sigkill.md`): a daemon killed by its
 * process group, as a hosted test's `kill(0, "SIGKILL")` does, leaves its
 * record with a stale heartbeat. `live` with `died` when it is down and the
 * record still names a daemon, which a shutdown clears; its shutdown never
 * began (`shutDown`), so one killed while it shut down is not dead; and its
 * lock is free (`daemonGone`). A record with no incarnation (a release before
 * task 001-270) has no shutdown mark. The runs it left open are those it
 * started. Row 011-251 (F4): a start marked at `now` takes the lock's place
 * (`lockOf`): a daemon that holds the lock and marks its start is starting,
 * so the recorded one is gone; a hook's spawn mark proves nothing of it.
 */
export function withDeath(
  store: Store,
  worktree: WorktreeRecord | null,
  live: DaemonLiveness,
  now: EpochMs,
): DaemonLiveness {
  const record = worktree?.daemon ?? null;
  if (live.state !== "down" || worktree === null || record === null) return live;
  const { id } = worktree;
  const self = daemonIncarnation(record);
  if (self !== null && shutDown(store, id, self)) return live;
  const lock = lockOf(worktree, now);
  if (lock.state === "starting") return { ...live, startingSince: lock.since, startMark: "start" };
  if (lock.state !== "gone") return live;
  const runs = store.runs
    .inFlight(id, record.startedAt)
    .map((run) => ({ id: run.id, revision: run.revision, testFiles: run.testFiles }));
  return { ...live, died: { runs } };
}

/**
 * Whether the daemon of incarnation `self` began its shutdown: its exit row
 * (`daemonExitMetaKey`), or the first note its shutdown writes, which names
 * its incarnation (`exitOf`), the only mark a 0.1.121 daemon leaves, so a
 * step-down from that release still reads as one. Any other note, a
 * watcher's or a runner's, proves nothing (review wave-13af B1).
 */
export function shutDown(store: Store, worktreeId: WorktreeId, self: string): boolean {
  if (store.meta.get(daemonExitMetaKey(worktreeId)) === self) return true;
  return readDaemonNotes(store, worktreeId).some((note) => note.exitOf === self);
}

/** What a reader learns of the worktree's daemon lock (`lockOf`). */
export type LockReading =
  | { readonly state: "starting"; readonly since: EpochMs }
  | { readonly state: "spawned" | "held" | "gone" };

/**
 * Row 011-251 (F4, gh-1): the worktree's daemon lock as a reader that meets
 * a record may read it, the marks first (`marksOf`); with neither, the lock
 * taken and released at once (`daemonGone`), `gone` or `held`. A probe while
 * a start is marked could make an older spawn exit as a loser (C9).
 */
export function lockOf(worktree: WorktreeRecord, now: EpochMs): LockReading {
  return marksOf(worktree, now) ?? { state: daemonGone(worktree) ? "gone" : "held" };
}

/**
 * The marks beside the worktree's daemon lock (`daemonStart`), read without
 * the lock: `starting`, a daemon holds it and marks its start; `spawned`, a
 * hook spawned one within `DAEMON_START_GRACE_MS` of `now` after the last
 * heartbeat, which may be taking it; `null` with neither.
 */
export function marksOf(worktree: WorktreeRecord, now: EpochMs): LockReading | null {
  const lockFile = lockFileFor(worktree.commonDir, worktree.id);
  const heartbeat = worktree.daemon?.heartbeatAt ?? worktree.lastHeartbeatAt ?? null;
  const start = daemonStart(lockFile, now, heartbeat);
  if (start?.kind === "locked") return { state: "starting", since: start.since };
  if (start?.kind === "spawned") return { state: "spawned" };
  return null;
}

/**
 * Whether no process holds the worktree's daemon lock, which the OS releases
 * on any death (D10). A daemon stopped or wedged past its heartbeat still
 * holds it (lessons, defect 22). Taken and released at once, as
 * `waiterLockState` probes a waiter's; no lock file means no daemon of this
 * store ever ran here, so the record proves nothing.
 */
export function daemonGone(worktree: WorktreeRecord): boolean {
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
