import { mkdirSync, utimesSync } from "node:fs";
import { dirname } from "node:path";
import { acquireDaemonLock, type DaemonLock } from "../../src/core/daemon/lock.js";
import { appendNote } from "../../src/core/notes.js";
import {
  claimHandoff,
  endHandoff,
  FeedDeliveredRow,
  markExit,
  markRest,
  markSpawn,
  markStart,
  markStopped,
  spawnedAfterRest,
  startMarkFor,
} from "../../src/core/presence/index.js";
import { lockFileFor } from "../../src/core/store/index.js";
import {
  type AbsolutePath,
  type DaemonRecord,
  daemonIncarnation,
  type EpochMs,
  type RevisionNumber,
  type Store,
  type WorktreeId,
} from "../../src/core/types/index.js";
import { appendRevisions, fakeRepo, seedStore } from "../status/helpers.js";

/*
 * Row 011-293: the stored facts of one table row, written as the daemon, its
 * hooks and the CLI write them, into a scratch store and lock directory.
 * Times are offsets from `NOW` in ms. Row 011-294: the marks are written by
 * the presence events (`presence/events.ts`, `presence/lock-events.ts`), the
 * worktree's row and record by the store's repository.
 */

export const NOW = Date.UTC(2026, 10, 4, 8, 0, 0) as EpochMs;
export const at = (offset: number) => (NOW + offset) as EpochMs;

/** The recorded daemon's start, version and incarnation. */
export const STARTED = at(-600_000);
export const VERSION = "0.1.400";
export const SELF = `${VERSION}@${STARTED}#tok`;
/** When a start mark was written (its file's time). */
export const START_MARKED = at(-4_000);
/** The run a dead daemon left open. */
export const OPEN_RUN = {
  id: "r1",
  revision: 2 as RevisionNumber,
  testFiles: [{ project: "", path: "test/a.test.ts" }],
};

export interface Stored {
  /** The worktree has no row. */
  readonly noRow?: true;
  /** The recorded daemon's last heartbeat; none, its record cleared. */
  readonly heartbeat?: number;
  /** With the record cleared, the heartbeat the row keeps. */
  readonly lastHeartbeat?: number;
  /** Its shutdown began: the exit row, or the exit note at this time; `other`, another incarnation's exit row. */
  readonly exit?: "mark" | "other" | { readonly note: number };
  /** A handoff claim at this time, for the recorded daemon (or the cleared one's incarnation). */
  readonly claim?: number;
  /** The short handoff's mark names the recorded daemon. */
  readonly short?: true;
  readonly rest?: { readonly at: number; readonly spawnedAt?: number };
  readonly stop?: { readonly at: number; readonly untilStart?: true };
  /** The change feed's last delivery. */
  readonly feed?: number;
  /** A start mark naming this process; with `lock: "held"`, the starting daemon's lock. */
  readonly startMark?: true;
  readonly spawnMark?: number;
  /** The lock file: a process holds it, or it is free. Absent: no lock file. */
  readonly lock?: "held" | "free";
  /** The recorded daemon left a run open. */
  readonly openRun?: true;
}

export interface Scratch {
  readonly store: Store;
  readonly id: WorktreeId;
  /** The worktree's root and common dir, as a hook locates them. */
  readonly root: AbsolutePath;
  readonly commonDir: AbsolutePath;
  readonly release: () => void;
}

/** A scratch store and lock directory holding `stored`. */
export function scratch(stored: Stored): Scratch {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const id = stored.noRow === true ? repo.addWorktree("norow").id : repo.mainId;
  appendRevisions(store, repo.mainId, 2, { head: null, dirty: true });
  const record: DaemonRecord | null =
    stored.heartbeat === undefined
      ? null
      : {
          socketPath: "/tmp/sq-presence.sock",
          startedAt: STARTED,
          heartbeatAt: at(stored.heartbeat),
          heartbeatIntervalMs: 5_000,
          squealVersion: VERSION,
          token: "tok",
        };
  if (stored.noRow !== true) {
    store.worktrees.upsert({
      id,
      root: repo.main,
      commonDir: repo.commonDir,
      isMain: true,
      registeredAt: 1,
      daemon: record,
      ...(stored.lastHeartbeat === undefined ? {} : { lastHeartbeatAt: at(stored.lastHeartbeat) }),
    });
  }
  writeMeta(store, id, stored);
  if (stored.openRun === true) {
    store.runs.start({
      ...OPEN_RUN,
      worktreeId: id,
      checkpointId: null,
      logDir: "/tmp/r1",
      startedAt: at(-100_000),
    });
  }
  const lockFile = lockFileFor(repo.commonDir, repo.mainId);
  mkdirSync(dirname(lockFile), { recursive: true });
  let held: DaemonLock | null = null;
  if (stored.lock !== undefined) {
    const lock = acquireDaemonLock(lockFile);
    if (stored.lock === "held") held = lock;
    else lock?.release();
  }
  if (stored.startMark === true) {
    // Only the lock's holder marks its start.
    if (held === null) throw new Error("a start mark needs the held lock");
    held = markStart(lockFile, held);
    utimesSync(startMarkFor(lockFile), START_MARKED / 1_000, START_MARKED / 1_000);
  }
  if (stored.spawnMark !== undefined) markSpawn(lockFile, at(stored.spawnMark), null);
  const root = repo.main as AbsolutePath;
  const commonDir = repo.commonDir as AbsolutePath;
  return { store, id, root, commonDir, release: () => held?.release() };
}

function writeMeta(store: Store, id: WorktreeId, stored: Stored): void {
  const { exit, claim, rest, stop, feed } = stored;
  if (stored.short === true) {
    // A successor older than the claim it ends (row 011-140): before the row's own claim.
    claimHandoff(store, id, { from: `${VERSION}@1#gone`, to: "0.1.401", at: at(-50_000) });
    store.transaction(() =>
      endHandoff(store, id, {
        of: SELF,
        version: VERSION,
        executable: "/k/cli.mjs",
        at: at(-50_000),
      }),
    );
  }
  if (exit === "mark") store.transaction(() => markExit(store, id, SELF));
  else if (exit === "other") store.transaction(() => markExit(store, id, `${VERSION}@1#other`));
  else if (exit !== undefined) {
    appendNote(store, id, {
      at: at(exit.note),
      revision: 2,
      text: "daemon stepped down",
      exitOf: SELF,
    });
  }
  if (claim !== undefined) claimHandoff(store, id, { from: SELF, to: "0.1.401", at: at(claim) });
  if (rest !== undefined) {
    markRest(store, id, at(rest.at));
    if (rest.spawnedAt !== undefined) spawnedAfterRest(store, id, at(rest.spawnedAt));
  }
  if (stop !== undefined) {
    store.transaction(() => markStopped(store, id, at(stop.at), "t", stop.untilStart === true));
  }
  if (feed !== undefined) {
    new FeedDeliveredRow(store, id, (error) => {
      throw error;
    }).record(at(feed));
  }
}

/** `daemonIncarnation` agrees with `SELF`, so a claim and the marks name the recorded daemon. */
export const selfChecked =
  daemonIncarnation({ squealVersion: VERSION, startedAt: STARTED, token: "tok" }) === SELF;
