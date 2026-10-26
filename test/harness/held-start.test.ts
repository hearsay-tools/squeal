import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireDaemonLock, type DaemonLock } from "../../src/core/daemon/lock.js";
import { markStart, spawnMarkFor, startMarkFor } from "../../src/core/daemon/start-mark.js";
import { DAEMON_START_GRACE_MS } from "../../src/core/delivery/index.js";
import { lockFileFor } from "../../src/core/store/index.js";
import type { AbsolutePath, WorktreeId } from "../../src/core/types/index.js";
import { type HookDeps, runHook } from "../../src/harness/claude-code/index.js";
import { runCodexHook } from "../../src/harness/codex/index.js";
import { codexRecorded } from "./codex/helpers.js";
import { recorded, squealRepo } from "./helpers.js";

/*
 * Row 011-252 (gh-1, row 011-250's notes F3): while a daemon starts with
 * its record cleared and no socket yet, every hook boundary spawned one more
 * daemon, which lost the lock and waited for it up to 30 s
 * (`VACANT_LOCK_WAIT_MS`), then noted "a daemon gave up": measured, 3
 * boundaries, 3 such waiters (`tasks/011-252/notes.md`). A boundary that
 * finds a start current, as status reads it (`marksOf`), now spawns none.
 */

const T = Date.UTC(2026, 0, 2, 14, 2);
const BOUNDARIES = ["Codex PostToolUse", "Claude Code PostToolBatch", "Claude Code Stop"] as const;

const locks: DaemonLock[] = [];
afterEach(() => {
  for (const lock of locks.splice(0)) lock.release();
});

/**
 * A worktree with one passing check, a Claude Code and a Codex session told
 * alive at their registration, then the daemon's record `record` after its
 * last heartbeat 60 s before `T`. `spawns` names the boundary of each spawn
 * the hooks' `ensureDaemon` answered; `at(ms)` runs every boundary `ms` after
 * `T`, in `BOUNDARIES`' order.
 */
async function afterHeartbeat(record: "cleared" | "stale") {
  const r = squealRepo();
  r.apply(r.pass());
  let clock = T;
  const spawns: string[] = [];
  const deps = (boundary: string): HookDeps => ({
    env: {},
    now: () => clock,
    ensureDaemon: async () => {
      spawns.push(boundary);
      return "spawned";
    },
  });
  const alive: HookDeps = { env: {}, now: () => clock, ensureDaemon: async () => "alive" };
  await runHook("session-start", recorded("session-start", r.root), alive);
  await runCodexHook("session-start", codexRecorded("exec", "session-start", r.root), alive);
  r.daemon("stale", T - 60_000);
  if (record === "cleared") r.store.worktrees.setDaemon(r.worktreeId, null);
  const [toolUse, batch, stop] = BOUNDARIES;
  const at = async (ms: number) => {
    clock = T + ms;
    await runCodexHook(
      "post-tool-use",
      codexRecorded("exec", "post-tool-use", r.root),
      deps(toolUse),
    );
    await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps(batch));
    await runHook("stop", recorded("stop", r.root), deps(stop));
  };
  const lockFile = lockFileFor(r.repo.commonDir as AbsolutePath, r.worktreeId as WorktreeId);
  mkdirSync(dirname(lockFile), { recursive: true });
  return { r, at, spawns, lockFile };
}

/** The daemon a hook spawned takes the lock and marks its start, as `openDaemon` does. */
function holdStart(lockFile: AbsolutePath): DaemonLock {
  const taken = acquireDaemonLock(lockFile);
  if (taken === null) throw new Error("the lock is taken");
  const lock = markStart(lockFile, taken);
  locks.push(lock);
  return lock;
}

/** A hook's spawn mark, `ms` after `T`. */
const spawnedAt = (lockFile: AbsolutePath, ms: number) =>
  writeFileSync(spawnMarkFor(lockFile), JSON.stringify({ at: T + ms }));

describe("a hook boundary during a daemon's start (row 011-252)", () => {
  it("spawns one daemon over every boundary of a held start, and again once the start failed", async () => {
    const { at, spawns, lockFile } = await afterHeartbeat("cleared");

    // The first boundary finds no daemon and no start: it spawns, and marks the spawn.
    await at(0);
    expect(spawns).toEqual([BOUNDARIES[0]]);
    // Before the daemon takes the lock: the spawn mark, within its grace.
    await at(1_000);
    // The daemon holds the lock and marks its start: a slow start, long past the spawn mark's grace.
    const lock = holdStart(lockFile);
    for (const ms of [5_000, DAEMON_START_GRACE_MS + 1_000, 30_000, 85_000]) await at(ms);
    expect(spawns).toEqual([BOUNDARIES[0]]);

    // The start fails: the lock and its mark go. The first spawn keeps its time (row 011-251),
    // long past its grace, so each boundary spawns until a new daemon marks its start.
    lock.release();
    await at(86_000);
    expect(spawns).toEqual([BOUNDARIES[0], ...BOUNDARIES]);
  });

  it("spawns none while a daemon's start is marked over a stale record, as status reads a replacement", async () => {
    const { at, spawns, lockFile } = await afterHeartbeat("stale");
    holdStart(lockFile);

    await at(0);
    await at(DAEMON_START_GRACE_MS + 1_000);

    expect(spawns).toEqual([]);
  });

  // The first boundary spawns and marks its spawn; the next two find that spawn within its grace.
  it("spawns when the start mark names a process that is gone", async () => {
    const { at, spawns, lockFile } = await afterHeartbeat("cleared");
    const gone = spawnSync(process.execPath, ["-e", ""]).pid;
    writeFileSync(startMarkFor(lockFile), JSON.stringify({ pid: gone, startTime: 1 }));

    await at(0);

    expect(spawns).toEqual([BOUNDARIES[0]]);
  });

  it("spawns when the spawn mark is not after the last heartbeat", async () => {
    const { r, at, spawns, lockFile } = await afterHeartbeat("cleared");
    spawnedAt(lockFile, -5_000);
    r.daemon("stale", T - 1_000);
    r.store.worktrees.setDaemon(r.worktreeId, null);

    await at(0);

    expect(spawns).toEqual([BOUNDARIES[0]]);
  });

  // The first spawn since the last heartbeat keeps its time (row 011-251), so each boundary spawns.
  it("spawns at every boundary while the spawn mark's grace has passed and no start is marked", async () => {
    const { at, spawns, lockFile } = await afterHeartbeat("cleared");
    spawnedAt(lockFile, -DAEMON_START_GRACE_MS - 1);

    await at(0);

    expect(spawns).toEqual(BOUNDARIES);
  });

  it("spawns at every boundary with a stale record and a spawn mark alone: a busy daemon may hold the lock", async () => {
    const { at, spawns, lockFile } = await afterHeartbeat("stale");
    spawnedAt(lockFile, -1_000);

    await at(0);

    expect(spawns).toEqual(BOUNDARIES);
  });
});
