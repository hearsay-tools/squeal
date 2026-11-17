import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import { acquireDaemonLock } from "../../src/core/daemon/lock.js";
import { DAEMON_START_GRACE_MS, DAEMON_START_SLOW_MS } from "../../src/core/presence/heartbeat.js";
import { startMarkFor } from "../../src/core/presence/marks.js";
import { lockFileFor } from "../../src/core/store/paths.js";
import { utcTimeText } from "../../src/core/text.js";
import type { AbsolutePath, WorktreeId } from "../../src/core/types/common.js";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { recorded, squealRepo } from "./helpers.js";
import { holdStart, locks, newWorktree, T, text } from "./starting-fixture.js";

/*
 * Row 005-108 (the human's screenshot, 2026-11-18, a new worktree on 0.1.542): the session
 * start said "Squeal is still starting", and the first tool boundary after the start's grace
 * said "no daemon is running; `squeal start` starts one", while the daemon the start spawned
 * held the worktree's lock and marked its start (a slow store check). A new worktree has no
 * row until its daemon registers.
 */

describe.each(["none", "cleared"] as const)(
  "a daemon that holds its lock past the start's grace, worktree row %s (row 005-108)",
  (row) => {
    it("is not told as no daemon running, and no boundary spawns a second daemon", async () => {
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
      // Before row 005-108, with no row, each of these 4 boundaries spawned one more daemon.
      expect(spawns).toEqual([0]);
    });
  },
);

describe("a new worktree whose daemon holds its lock in its start (row 005-108)", () => {
  it("is starting at Stop and in squeal status, past the start's grace", async () => {
    const { stop, status, lockFile } = await newWorktree();
    holdStart(lockFile);

    const atStop = await stop(30_000);
    const statusText = status(30_000);

    expect(atStop).not.toContain("no daemon is running");
    expect(atStop).not.toContain("start` starts one");
    // Before row 005-108: "no daemon has validated; results are as of revision 0; `squeal start` starts one".
    expect(statusText).toContain("a daemon holds this worktree's lock but does not serve yet");
    expect(statusText).not.toContain("start` starts one");
  });
});

describe("a new worktree whose daemon never takes the lock (row 005-108: as before)", () => {
  it("is starting within the spawn's grace, then no daemon is running, and the next boundary spawns", async () => {
    const { batch, spawns } = await newWorktree();

    expect(await batch(2_000)).not.toContain("no daemon is running");
    const after = await batch(DAEMON_START_GRACE_MS + 1_000);

    expect(after).toContain("no daemon is running; `squeal start` starts one");
    // The spawn mark holds the next spawn back within its grace only.
    expect(spawns).toEqual([0, DAEMON_START_GRACE_MS + 1_000]);
  });

  it("is told no daemon running past the grace when its start mark names a process that is gone", async () => {
    const { batch, lockFile } = await newWorktree();
    const gone = spawnSync(process.execPath, ["-e", ""]).pid;
    writeFileSync(startMarkFor(lockFile), JSON.stringify({ pid: gone, startTime: 1 }));

    expect(await batch(DAEMON_START_GRACE_MS + 1_000)).toContain("no daemon is running");
  });
});

describe("a new worktree whose daemon's start outlasts DAEMON_START_SLOW_MS (row 005-108)", () => {
  it("says once that a daemon is still starting, and since when, never what starts one", async () => {
    const { batch, stop, status, spawns, lockFile } = await newWorktree();
    holdStart(lockFile, 1_000);
    const slowAt = 1_000 + DAEMON_START_SLOW_MS + 1_000;

    const before = [];
    for (const ms of [2_000, DAEMON_START_GRACE_MS + 1_000, 30_000]) before.push(await batch(ms));
    const slow = await batch(slowAt);
    const after = [await batch(slowAt + 5_000), await stop(slowAt + 10_000)];
    const statusText = status(slowAt + 10_000);

    expect(before).toEqual(["", "", ""]);
    expect(slow).toBe(
      "SQUEAL · a daemon is still starting at revision 0\n" +
        `Revision 0: A daemon has been starting since ${utcTimeText(T + 1_000)}, ` +
        "and Squeal has no results in this worktree yet.",
    );
    // The evals read it as no daemon validating (`NO_DAEMON`).
    expect(squealEvidence(slow, "push")?.daemon).toBe(false);
    expect(after).toEqual(["", ""]);
    expect(statusText).toContain("a daemon holds this worktree's lock but does not serve yet");
    expect(statusText).not.toContain("start` starts one");
    expect(spawns).toEqual([0]);
  });
});

describe("a registered daemon that holds the lock and does not answer (SIGSTOP, lessons defect 22)", () => {
  it("is told as before: its heartbeat is late, not starting, and no second daemon is spawned", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    r.daemon("stale", T - 60_000);
    let clock = T;
    let answer: "spawned" | "unavailable" = "spawned";
    const spawns: number[] = [];
    const deps: HookDeps = {
      env: {},
      now: () => clock,
      ensureDaemon: async () => {
        if (answer === "spawned") spawns.push(clock - T);
        return answer;
      },
    };
    await runHook("session-start", recorded("session-start", r.root), deps);
    // The stopped daemon holds its lock and wrote no start mark: it registered long ago.
    const lockFile = lockFileFor(r.repo.commonDir as AbsolutePath, r.worktreeId as WorktreeId);
    mkdirSync(dirname(lockFile), { recursive: true });
    const taken = acquireDaemonLock(lockFile);
    if (taken === null) throw new Error("the lock is taken");
    locks.push(taken);
    // Its socket does not answer in time: the real ensure reads `unavailable`.
    answer = "unavailable";
    clock = T + 5 * 60_000;

    const said = text(await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps));

    expect(said).toContain("heartbeat is late");
    expect(said).not.toContain("starting");
    expect(spawns).toEqual([0]);
  });
});
