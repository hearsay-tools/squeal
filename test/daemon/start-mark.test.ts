import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type WaitLiveness, watchDaemon } from "../../src/cli/wait-liveness.js";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { acquireDaemonLock } from "../../src/core/daemon/lock.js";
import { abandon, openDaemon } from "../../src/core/daemon/open.js";
import {
  markSpawn,
  markStart,
  startMarked,
  startMarkFor,
} from "../../src/core/daemon/start-mark.js";
import { squealVersion } from "../../src/core/daemon/version.js";
import { readStatus } from "../../src/core/status/snapshot.js";
import { lockFileFor, openStore } from "../../src/core/store/index.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../../src/core/types/index.js";
import { createFixtureRepo, type FixtureRepo } from "./helpers.js";

/*
 * Review 0.1.350, B1 (row 011-250): a wait that probed the daemon lock took
 * it for a moment. A hook's spawn older than the last daemon recorded that
 * met the probe gave up as a loser (C9's version rule), with no daemon
 * serving after a signal stop. A starting daemon now marks its start beside
 * the lock, and the wait reads the mark and takes no lock.
 */

const repos: FixtureRepo[] = [];
const subscriptions: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const end of subscriptions.splice(0)) end();
  for (const repo of repos.splice(0)) repo.cleanup();
});

/** `pauseAt`'s channel (`src/core/daemon/test-pause.ts`); a daemon this process starts publishes to it. */
const TEST_PAUSE_CHANNEL = "squeal:test-pause";

const now = () => Date.now() as EpochMs;

/** A version newer than this Squeal's: the daemon a signal stopped, of a later plugin. */
function newer(): string {
  const [major = 0, minor = 0, patch = 0] = squealVersion().split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function fixture(): { repo: FixtureRepo; id: WorktreeId; lockFile: AbsolutePath } {
  const repo = createFixtureRepo();
  repos.push(repo);
  const id = repo.worktreeId as WorktreeId;
  return { repo, id, lockFile: lockFileFor(repo.commonDir as AbsolutePath, id) };
}

/** A daemon of `version` registered, then a signal stopped it: record cleared, no handoff claimed. */
function stoppedDaemonOf(repo: FixtureRepo, version: string): void {
  const store = openStore(repo.commonDir as AbsolutePath);
  if ("reason" in store) throw new Error("no store");
  const id = repo.worktreeId as WorktreeId;
  store.worktrees.upsert({
    id,
    root: repo.root as AbsolutePath,
    commonDir: repo.commonDir as AbsolutePath,
    isMain: true,
    registeredAt: 1,
    daemon: {
      socketPath: repo.socketPath as AbsolutePath,
      startedAt: 7 as EpochMs,
      heartbeatAt: Date.now() as EpochMs,
      heartbeatIntervalMs: 5_000,
      squealVersion: version,
    },
  });
  store.worktrees.setDaemon(id, null);
  expect(store.worktrees.lastDaemon(id)?.squealVersion).toBe(version);
  store.close();
}

/** A daemon of `version` registered, then died with SIGKILL: its record left, its heartbeat stale. */
function killedDaemonOf(repo: FixtureRepo, version: string): void {
  const store = openStore(repo.commonDir as AbsolutePath);
  if ("reason" in store) throw new Error("no store");
  store.worktrees.upsert({
    id: repo.worktreeId as WorktreeId,
    root: repo.root as AbsolutePath,
    commonDir: repo.commonDir as AbsolutePath,
    isMain: true,
    registeredAt: 1,
    daemon: {
      socketPath: repo.socketPath as AbsolutePath,
      startedAt: 7 as EpochMs,
      heartbeatAt: (Date.now() - 60_000) as EpochMs,
      heartbeatIntervalMs: 5_000,
      squealVersion: version,
      token: "killed",
    },
  });
  store.close();
}

/** What plain status reads of the daemon, as `squeal status` and `squeal start` print it. */
function statusDaemon(repo: FixtureRepo) {
  const status = readStatus(repo.root as AbsolutePath, { now });
  if (!status.available) throw new Error("status unavailable");
  return status.daemon;
}

/**
 * The wait's worst moment for a start: `judge` runs at the start's first
 * `BEGIN EXCLUSIVE` on `lockFile`, and that attempt runs inside any
 * exclusive transaction the judge opens itself, as one that probed the lock
 * held it. The review's probe forced the same order. Returns the readings.
 */
function pollAtLockAttempt<T = WaitLiveness>(lockFile: AbsolutePath, judge: () => T): T[] {
  const exec = DatabaseSync.prototype.exec;
  const readings: T[] = [];
  let attempt: (() => void) | null = null;
  vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    if (sql !== "BEGIN EXCLUSIVE") return exec.call(this, sql);
    if (attempt !== null) {
      // The judge holds an exclusive transaction: the start tries the lock now.
      exec.call(this, sql);
      const tried = attempt;
      attempt = null;
      tried();
      return;
    }
    if (readings.length > 0 || this.location() !== lockFile) return exec.call(this, sql);
    let failure: { readonly error: unknown } | null = null;
    let tried = false;
    attempt = () => {
      tried = true;
      try {
        exec.call(this, sql);
      } catch (error) {
        failure = { error };
      }
    };
    readings.push(judge());
    if (!tried) attempt();
    attempt = null;
    if (failure !== null) throw (failure as { readonly error: unknown }).error;
  });
  return readings;
}

describe("an older daemon's start beside a wait (review 0.1.350, B1)", () => {
  it("succeeds after a newer daemon's signal stop, with a wait polling at its lock attempt", async () => {
    const { repo, id, lockFile } = fixture();
    stoppedDaemonOf(repo, newer());
    const watch = watchDaemon(id, { lockFile });
    const readings = pollAtLockAttempt(lockFile, () => watch.judge(null, now()));

    const opened = await openDaemon(repo.root, now);

    if ("reason" in opened) throw new Error(`the start lost: ${opened.message}`);
    // Before it holds the lock no mark exists (follow-up F1); once it holds it, the wait goes on.
    expect(readings).toEqual([{ state: "down", reason: "stopped" }]);
    vi.restoreAllMocks();
    expect(watch.judge(null, now())).toEqual({ state: "lapsed", locked: true });
    await abandon(opened, now, undefined, "the test ends this start");
    expect(existsSync(startMarkFor(lockFile))).toBe(false);
    expect(watch.judge(null, now())).toEqual({ state: "down", reason: "stopped" });
  });

  it("still loses to a newer daemon that holds the lock, and leaves its mark", async () => {
    const { repo, lockFile } = fixture();
    stoppedDaemonOf(repo, newer());
    // The newer daemon, starting again: it holds the lock and marks its start.
    const taken = acquireDaemonLock(lockFile);
    if (taken === null) throw new Error("the lock is taken");
    const holder = markStart(lockFile, taken);
    try {
      const result = await openDaemon(repo.root, now);
      if (!("reason" in result)) await abandon(result, now, undefined, "the test ends this start");
      expect(result).toMatchObject({ reason: "lost-lock", code: 0 });
      expect(startMarked(lockFile)).toBe(true);
    } finally {
      holder.release();
    }
    expect(existsSync(startMarkFor(lockFile))).toBe(false);
  });
});

describe("an older daemon's start beside a status probe (row 011-251, F4)", () => {
  it("succeeds after a newer daemon died, with status reading at its lock attempt after a hook's spawn", async () => {
    const { repo, lockFile } = fixture();
    killedDaemonOf(repo, newer());
    // The hook that spawned this start marked it (`ensure`).
    markSpawn(lockFile, now());
    const readings = pollAtLockAttempt(lockFile, () => statusDaemon(repo));

    const opened = await openDaemon(repo.root, now);

    if ("reason" in opened) throw new Error(`the start lost: ${opened.message}`);
    // Status took no lock: the spawn may be taking it, so no death is named yet.
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({ state: "down" });
    expect(readings[0]).not.toHaveProperty("died");
    vi.restoreAllMocks();
    // Once it holds the lock it marks its start, and status names a start, with no probe.
    expect(statusDaemon(repo)).toMatchObject({ state: "down", startingSince: expect.any(Number) });
    await abandon(opened, now, undefined, "the test ends this start");
  });

  it("control: with no spawn mark, status's probe at its lock attempt still makes it lose", async () => {
    // A spawn no hook marked: `squeal start`, or a hook older than row 011-251.
    const { repo, lockFile } = fixture();
    killedDaemonOf(repo, newer());
    const readings = pollAtLockAttempt(lockFile, () => statusDaemon(repo));

    const result = await openDaemon(repo.root, now);

    if (!("reason" in result)) await abandon(result, now, undefined, "the test ends this start");
    expect(readings).toHaveLength(1);
    expect(result).toMatchObject({ reason: "lost-lock" });
  });
});

describe("a daemon's start mark (review 0.1.350, B1)", () => {
  it("names this process from the lock until the record, and is gone once it serves and once it stops", async () => {
    const { repo, lockFile } = fixture();
    let atStoreOpen: unknown = null;
    const onPause = (point: unknown) => {
      if (point !== "store-open") return;
      atStoreOpen = JSON.parse(readFileSync(startMarkFor(lockFile), "utf8"));
    };
    subscribe(TEST_PAUSE_CHANNEL, onPause);
    subscriptions.push(() => unsubscribe(TEST_PAUSE_CHANNEL, onPause));

    const daemon = await startDaemon({ root: repo.root, env: repo.env, now });

    if ("reason" in daemon) throw new Error(`exited: ${daemon.message}`);
    expect(atStoreOpen).toMatchObject({ pid: process.pid });
    expect(existsSync(startMarkFor(lockFile))).toBe(false);
    await daemon.stop("stop-requested");
    expect(existsSync(startMarkFor(lockFile))).toBe(false);
  });
});
