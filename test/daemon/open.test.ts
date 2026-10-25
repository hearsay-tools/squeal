import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenedDaemon } from "../../src/core/daemon/open.js";
import type {
  AbsolutePath,
  DaemonExit,
  DaemonRecord,
  WorktreeId,
} from "../../src/core/types/index.js";
import { createFixtureRepo, type FixtureRepo, readNotes } from "./helpers.js";

const integrityChecks = vi.hoisted(() => ({ count: 0 }));

vi.mock("../../src/core/store/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/store/index.js")>();
  return {
    ...actual,
    openStore: ((...args: Parameters<typeof actual.openStore>) => {
      if (args[1]?.checkIntegrity !== undefined) integrityChecks.count++;
      return actual.openStore(...args);
    }) as typeof actual.openStore,
  };
});

const { openDaemon } = await import("../../src/core/daemon/open.js");
const { removeScratch } = await import("../../src/core/daemon/scratch.js");

const repos: FixtureRepo[] = [];
const opened: OpenedDaemon[] = [];
afterEach(() => {
  for (const daemon of opened.splice(0)) {
    daemon.store.close();
    removeScratch(daemon.scratch);
    daemon.lock.release();
  }
  for (const repo of repos.splice(0)) repo.cleanup();
  integrityChecks.count = 0;
});

describe("openDaemon: lock before store (spec 001 D10, review S8)", () => {
  it("five concurrent starts run the integrity check once: losers never open the store", async () => {
    const repo = createFixtureRepo();
    repos.push(repo);
    const results = await Promise.all(
      // No lock wait: no winner here registers, which a waiting loser would wait for.
      Array.from({ length: 5 }, () => openDaemon(repo.root, Date.now, undefined, 0)),
    );
    const winners = results.filter((r): r is OpenedDaemon => !("reason" in r));
    opened.push(...winners);
    const losers = results.filter((r): r is DaemonExit => "reason" in r);
    expect(winners).toHaveLength(1);
    expect(losers.map((exit) => exit.reason)).toEqual(Array(4).fill("lost-lock"));
    expect(integrityChecks.count).toBe(1);
  });

  it("releases the lock when the store cannot be opened, so the next start can try", async () => {
    const repo = createFixtureRepo();
    repos.push(repo);
    const { storePaths } = await import("../../src/core/store/index.js");
    const { mkdirSync } = await import("node:fs");
    // A directory where the database file belongs: openStore fails.
    mkdirSync(storePaths(repo.commonDir).database, { recursive: true });
    const first = await openDaemon(repo.root, Date.now);
    expect(first).toMatchObject({ reason: "store-unusable", code: 1 });
    const { acquireDaemonLock } = await import("../../src/core/daemon/lock.js");
    const { lockFileFor } = await import("../../src/core/store/index.js");
    const lock = acquireDaemonLock(lockFileFor(repo.commonDir, repo.worktreeId));
    expect(lock).not.toBeNull();
    lock?.release();
  });
});

describe("openDaemon: a lost lock with no daemon recorded (task 001-340, D10)", () => {
  /** The lock as a stopping daemon past its record and socket holds it. */
  async function held(repo: FixtureRepo) {
    const { acquireDaemonLock } = await import("../../src/core/daemon/lock.js");
    const { lockFileFor } = await import("../../src/core/store/index.js");
    const lock = acquireDaemonLock(
      lockFileFor(repo.commonDir as AbsolutePath, repo.worktreeId as WorktreeId),
    );
    if (lock === null) throw new Error("the lock is taken");
    return lock;
  }

  /** The store with the worktree's row and `daemon` as its record, as a stopping daemon leaves it. */
  async function record(repo: FixtureRepo, daemon: DaemonRecord | null) {
    const { openStore } = await import("../../src/core/store/index.js");
    const store = openStore(repo.commonDir as AbsolutePath);
    if ("reason" in store) throw new Error("no store");
    const id = repo.worktreeId as WorktreeId;
    store.worktrees.upsert({
      id,
      root: repo.root as AbsolutePath,
      commonDir: repo.commonDir as AbsolutePath,
      isMain: true,
      registeredAt: 1,
      daemon,
    });
    store.close();
  }

  it("waits for the lock and takes it once the holder lets go", async () => {
    const repo = createFixtureRepo();
    repos.push(repo);
    const lock = await held(repo);
    setTimeout(() => lock.release(), 400);
    const started = performance.now();
    const result = await openDaemon(repo.root, Date.now);
    if ("reason" in result) throw new Error(`exited: ${result.message}`);
    opened.push(result);
    expect(performance.now() - started).toBeGreaterThanOrEqual(350);
  });

  it("exits with one note when the lock is still held at its bound", async () => {
    const repo = createFixtureRepo();
    repos.push(repo);
    await record(repo, null);
    const lock = await held(repo);
    try {
      const result = await openDaemon(repo.root, Date.now, undefined, 300);
      expect(result).toMatchObject({ reason: "lock-wait-timed-out", code: 0 });
      expect(readNotes(repo)).toEqual([
        "a daemon gave up: the lock was still held after 300 ms with no daemon serving; the next hook boundary starts one",
      ]);
      expect(integrityChecks.count).toBe(0);
    } finally {
      lock.release();
    }
  });

  /** A record of `squealVersion`, cleared as a stopping daemon's shutdown clears it (D10). */
  async function cleared(repo: FixtureRepo, squealVersion: string) {
    await record(repo, {
      socketPath: repo.socketPath as AbsolutePath,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
      heartbeatIntervalMs: 5_000,
      squealVersion,
    });
    const { openStore } = await import("../../src/core/store/index.js");
    const store = openStore(repo.commonDir as AbsolutePath);
    if ("reason" in store) throw new Error("no store");
    store.worktrees.setDaemon(repo.worktreeId as WorktreeId, null);
    store.close();
  }

  it("waits for a stopping daemon of its own version, and takes the lock", async () => {
    const repo = createFixtureRepo();
    repos.push(repo);
    const { squealVersion } = await import("../../src/core/daemon/version.js");
    await cleared(repo, squealVersion());
    const lock = await held(repo);
    setTimeout(() => lock.release(), 400);
    const result = await openDaemon(repo.root, Date.now);
    if ("reason" in result) throw new Error(`exited: ${result.message}`);
    opened.push(result);
  });

  it("exits at once, with no note, while a newer daemon than itself stops (review 001-344, B2)", async () => {
    const repo = createFixtureRepo();
    repos.push(repo);
    // A step-down's old daemon is newer than a late older hook's spawn.
    await cleared(repo, "999.0.0");
    const lock = await held(repo);
    try {
      const started = performance.now();
      const result = await openDaemon(repo.root, Date.now, undefined, 3_000);
      expect(result).toMatchObject({ reason: "lost-lock", code: 0 });
      expect(performance.now() - started).toBeLessThan(2_000);
      expect(readNotes(repo)).toEqual([]);
    } finally {
      lock.release();
    }
  });

  it("exits at once, with no note, while the store records a daemon serving", async () => {
    const repo = createFixtureRepo();
    repos.push(repo);
    await record(repo, {
      socketPath: repo.socketPath as AbsolutePath,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0-test",
    });
    const lock = await held(repo);
    try {
      const started = performance.now();
      const result = await openDaemon(repo.root, Date.now);
      expect(result).toMatchObject({ reason: "lost-lock", code: 0 });
      expect(performance.now() - started).toBeLessThan(5_000);
      expect(readNotes(repo)).toEqual([]);
    } finally {
      lock.release();
    }
  });
});
