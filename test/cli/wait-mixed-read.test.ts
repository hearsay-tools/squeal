import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { watchDaemon } from "../../src/cli/wait-liveness.js";
import { acquireDaemonLock, type DaemonLock } from "../../src/core/daemon/lock.js";
import { clearStartMark, markStart, startMarked } from "../../src/core/daemon/start-mark.js";
import { withStatusStore } from "../../src/core/status/open.js";
import { lockFileFor } from "../../src/core/store/index.js";
import type {
  AbsolutePath,
  DaemonRecord,
  EpochMs,
  Store,
  WorktreeId,
} from "../../src/core/types/index.js";
import { A, NOW, repoWith } from "./status-wait-fixture.js";

/*
 * Review 0.1.350-r2, N2 (row 011-251): a poll's read transaction can see the
 * cleared record of a daemon that is starting; the daemon then commits its
 * registration and removes its start mark; the poll reads no mark. Its
 * snapshot still has no record, so the wait said the daemon stopped. Before
 * that verdict the wait reads the record once more in a transaction of its
 * own, and goes on when it finds one.
 */

/**
 * Runs once, at the first start reading at or after `after` (`performance.now()`):
 * the registration and the mark's removal.
 */
const between = vi.hoisted(() => ({ run: null as (() => void) | null, after: 0 }));

vi.mock("../../src/core/daemon/start-mark.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/core/daemon/start-mark.js")>();
  const once = () => {
    if (performance.now() < between.after) return;
    const run = between.run;
    between.run = null;
    run?.();
  };
  return {
    ...real,
    daemonStart: (...args: Parameters<typeof real.daemonStart>) => {
      once();
      return real.daemonStart(...args);
    },
  };
});

const saved = { ...process.env };
let runtimeDir: string;
const locks: DaemonLock[] = [];
beforeEach(() => {
  // Socket paths are limited to 108 bytes; the test temp dir can be longer.
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
});
afterEach(() => {
  between.run = null;
  between.after = 0;
  for (const lock of locks.splice(0)) lock.release();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

/**
 * A worktree whose daemon is starting: its record cleared, the lock held
 * with its start marked. `register` commits its record on the fixture's own
 * connection and removes its mark, keeping the lock, as `#register` does.
 */
function starting() {
  const { repo, store } = repoWith([A]);
  const id = repo.mainId as WorktreeId;
  const record = store.worktrees.get(id)?.daemon;
  if (record === undefined || record === null) throw new Error("no record");
  store.worktrees.setDaemon(id, null);
  const lockFile = lockFileFor(repo.commonDir as AbsolutePath, id);
  mkdirSync(dirname(lockFile), { recursive: true });
  const lock = acquireDaemonLock(lockFile);
  if (lock === null) throw new Error("the lock is taken");
  locks.push(markStart(lockFile, lock));
  const registered: DaemonRecord = { ...record, heartbeatAt: NOW as EpochMs };
  const register = () => {
    store.worktrees.setDaemon(id, registered);
    clearStartMark(lockFile);
  };
  return { repo, store, id, lockFile, register };
}

/**
 * Registers at the first start reading 1 s into the wait: past the 750 ms
 * a wait settles in (`STATUS_WAIT_SETTLE_MS`), after which a stopped reading
 * ends it, and well before its 3 s deadline.
 */
function armAfterSettle(register: () => void): void {
  between.after = performance.now() + 1_000;
  between.run = register;
}

async function run(argv: string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
    now: () => NOW,
    env: {},
  };
  const code = await main(argv, io);
  return { code, stdout, stderr };
}

describe("a poll whose read began before the registration it then missed (review 0.1.350-r2, N2)", () => {
  it("judges the cleared record by a new read: lapsed while starting, never stopped", () => {
    const { repo, id, lockFile, register } = starting();
    const commonDir = repo.commonDir as AbsolutePath;
    const readings = withStatusStore(
      repo.main as AbsolutePath,
      {},
      ({ store }: { store: Store }) => {
        // The poll's read: it pins the cleared record.
        const pinned = store.worktrees.get(id)?.daemon ?? null;
        register();
        expect(startMarked(lockFile)).toBe(false);
        expect(store.worktrees.get(id)?.daemon ?? null).toBeNull();
        return {
          pinned,
          fresh: watchDaemon(id, { lockFile, commonDir }).judge(pinned, NOW as EpochMs),
          // Control: without the store to read again, the snapshot alone reads a stopped daemon.
          alone: watchDaemon(id, { lockFile }).judge(pinned, NOW as EpochMs),
        };
      },
    );
    expect(readings).toEqual({
      pinned: null,
      fresh: { state: "lapsed", locked: true },
      alone: { state: "down", reason: "stopped" },
    });
  });

  it("judges a cleared record that a new read finds cleared too as a stopped daemon", () => {
    const { repo, id, lockFile } = starting();
    for (const lock of locks.splice(0)) lock.release();
    const watch = watchDaemon(id, { lockFile, commonDir: repo.commonDir as AbsolutePath });
    expect(watch.judge(null, NOW as EpochMs)).toEqual({ state: "down", reason: "stopped" });
  });

  it("reads a store that does not open as proving nothing: stopped, as the snapshot says", () => {
    const { id, lockFile } = starting();
    for (const lock of locks.splice(0)) lock.release();
    const missing = mkdtempSync("/tmp/sq-none-") as AbsolutePath;
    try {
      const watch = watchDaemon(id, { lockFile, commonDir: missing });
      expect(watch.judge(null, NOW as EpochMs)).toEqual({ state: "down", reason: "stopped" });
    } finally {
      rmSync(missing, { recursive: true, force: true });
    }
  });

  it("named: a wait whose poll misses the registration goes on, and never says the daemon stopped", async () => {
    const { repo, register } = starting();
    armAfterSettle(register);

    const result = await run(["status", "--wait", "3000", A], repo.main);

    expect(between.run).toBeNull();
    expect(result.stdout).not.toContain("the daemon stopped");
    expect(result.stdout).not.toContain("squeal start");
    expect(result.stdout).toContain("Named test files have no verdict: the deadline passed");
  });

  it("pathless: a wait whose poll misses the registration goes on, and never says the daemon stopped", async () => {
    const { repo, register } = starting();
    armAfterSettle(register);

    const result = await run(["status", "--wait", "3000"], repo.main);

    expect(between.run).toBeNull();
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain("Returned without a daemon");
    expect(result.stdout).not.toContain("the daemon stopped");
    expect(result.stdout.trimEnd().split("\n").at(-1)).toMatch(
      /^Returned on timeout after 3\.\d s: /,
    );
  });
});
