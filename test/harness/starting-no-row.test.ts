import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireDaemonLock, type DaemonLock } from "../../src/core/daemon/lock.js";
import { DAEMON_START_GRACE_MS } from "../../src/core/presence/heartbeat.js";
import { markStart } from "../../src/core/presence/lock-events.js";
import { lockFileFor } from "../../src/core/store/paths.js";
import type { AbsolutePath, WorktreeId } from "../../src/core/types/common.js";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import type { HookResult } from "../../src/harness/claude-code/run.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { recorded, squealRepo } from "./helpers.js";

/*
 * Row 005-108 (the human's screenshot, 2026-11-18, a new worktree on 0.1.542): the session
 * start said "Squeal is still starting", and the first tool boundary after the start's grace
 * said "no daemon is running; `squeal start` starts one", while the daemon the start spawned
 * held the worktree's lock and marked its start (a slow store check). A new worktree has no
 * row until its daemon registers.
 */

const T = Date.UTC(2026, 10, 18, 9, 0);

const locks: DaemonLock[] = [];
afterEach(() => {
  for (const lock of locks.splice(0)) lock.release();
});

const text = (out: HookResult): string =>
  out.stdout === ""
    ? ""
    : ((JSON.parse(out.stdout) as { hookSpecificOutput?: { additionalContext?: string } })
        .hookSpecificOutput?.additionalContext ?? out.stdout);

/** A new worktree: a store, no row for it; one session started at `T`, its spawn answered. */
async function newWorktree(row: "none" | "cleared" = "none") {
  const r = squealRepo();
  if (row === "none") r.store.worktrees.remove(r.worktreeId);
  else r.daemon("none");
  let clock = T;
  const spawns: number[] = [];
  const deps: HookDeps = {
    env: {},
    now: () => clock,
    ensureDaemon: async () => {
      spawns.push(clock - T);
      return "spawned";
    },
  };
  const start = text(await runHook("session-start", recorded("session-start", r.root), deps));
  const lockFile = lockFileFor(r.repo.commonDir as AbsolutePath, r.worktreeId as WorktreeId);
  mkdirSync(dirname(lockFile), { recursive: true });
  const batch = async (ms: number) => {
    clock = T + ms;
    return text(await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps));
  };
  return { r, start, batch, spawns, lockFile };
}

/** The spawned daemon takes the lock and marks its start, as `openDaemon` does before its store check. */
function holdStart(lockFile: AbsolutePath): DaemonLock {
  const taken = acquireDaemonLock(lockFile);
  if (taken === null) throw new Error("the lock is taken");
  const lock = markStart(lockFile, taken);
  locks.push(lock);
  return lock;
}

describe.each(["none", "cleared"] as const)(
  "a daemon that holds its lock past the start's grace, worktree row %s (row 005-108)",
  (row) => {
    it("is not told as no daemon running, and no second daemon is spawned", async () => {
      const { start, batch, spawns, lockFile } = await newWorktree(row);
      expect(start).toMatch(/still starting|daemon is starting/);
      holdStart(lockFile);

      const said = [];
      for (const ms of [2_000, DAEMON_START_GRACE_MS + 1_000, 30_000, 85_000])
        said.push(await batch(ms));

      for (const line of said) {
        expect(line).not.toContain("no daemon is running");
        expect(line).not.toContain("no daemon is validating");
        expect(line).not.toContain("start` starts one");
      }
      expect(spawns).toEqual([0]);
    });
  },
);
