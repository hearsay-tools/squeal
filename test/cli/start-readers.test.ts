import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { watchDaemon } from "../../src/cli/wait-liveness.js";
import { acquireDaemonLock, type DaemonLock } from "../../src/core/daemon/lock.js";
import {
  clearStartMark,
  daemonStart,
  markSpawn,
  markStart,
  spawnMarkFor,
  startMarkFor,
} from "../../src/core/daemon/start-mark.js";
import { headerLines } from "../../src/core/delivery/header.js";
import { DAEMON_START_GRACE_MS, readLiveHeader } from "../../src/core/delivery/liveness.js";
import { LOCKED_TEXT } from "../../src/core/status/outstanding-text.js";
import { lockFileFor } from "../../src/core/store/index.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../../src/core/types/index.js";
import { A, NOW, repoWith } from "./status-wait-fixture.js";

/*
 * Row 011-251 (gh-1 follow-up; 011-250's notes F1, F2, F4): while a daemon
 * starts, every reader says it is starting. A hook that spawns a daemon
 * writes a spawn mark before the daemon can take the lock; a daemon that
 * holds the lock marks its start. A wait goes on, and plain status, a named
 * status and the hooks' header name the start in place of `squeal start`.
 */

const at = (ms: number) => ms as EpochMs;

const saved = { ...process.env };
let runtimeDir: string;
const locks: DaemonLock[] = [];
beforeEach(() => {
  // Socket paths are limited to 108 bytes; the test temp dir can be longer.
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
});
afterEach(() => {
  for (const lock of locks.splice(0)) lock.release();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

/**
 * A worktree at revision 4 whose daemon cleared its record, or with `stale`
 * left it with a heartbeat a minute old, and its lock file's path, its
 * directory made.
 */
function cleared(stale = false) {
  const { repo, store } = repoWith([A]);
  const id = repo.mainId as WorktreeId;
  const record = store.worktrees.get(id)?.daemon ?? null;
  store.worktrees.setDaemon(
    id,
    stale && record !== null ? { ...record, heartbeatAt: at(NOW - 60_000) } : null,
  );
  const lockFile = lockFileFor(repo.commonDir as AbsolutePath, id);
  mkdirSync(dirname(lockFile), { recursive: true });
  return { repo, store, id, lockFile };
}

/** Holds the lock at `path` as a starting daemon does, its start marked, until the test ends. */
function holdMarked(path: AbsolutePath): void {
  const lock = acquireDaemonLock(path);
  if (lock === null) throw new Error("the lock is taken");
  locks.push(markStart(path, lock));
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

const last = (text: string) => text.trimEnd().split("\n").at(-1) ?? "";

/** The `Outstanding:` group line that says no daemon validates. */
const noDaemonLine = (text: string) =>
  text.split("\n").find((line) => line.startsWith("  no daemon has validated"));

describe("a hook's spawn mark (row 011-251, F1)", () => {
  it("reads for DAEMON_START_GRACE_MS of its time, and not past it", () => {
    const { lockFile } = cleared();
    expect(daemonStart(lockFile, at(NOW))).toBeNull();
    markSpawn(lockFile, at(NOW));
    expect(daemonStart(lockFile, at(NOW))).toEqual({ kind: "spawned", since: NOW });
    expect(daemonStart(lockFile, at(NOW + DAEMON_START_GRACE_MS))).toMatchObject({
      kind: "spawned",
    });
    expect(daemonStart(lockFile, at(NOW + DAEMON_START_GRACE_MS + 1))).toBeNull();
    // A clock set back reads it for as long.
    expect(daemonStart(lockFile, at(NOW - DAEMON_START_GRACE_MS - 1))).toBeNull();
  });

  it("reads one that cannot be read or parsed as none", () => {
    const { lockFile } = cleared();
    const mark = spawnMarkFor(lockFile);
    for (const text of ["", "not json", "null", "{}", '{"at":"1"}', '{"at":null}']) {
      writeFileSync(mark, text);
      expect(daemonStart(lockFile, at(NOW)), text).toBeNull();
    }
    rmSync(mark);
    mkdirSync(mark);
    expect(daemonStart(lockFile, at(NOW))).toBeNull();
  });

  it("is never written over the start mark, which a holder's start reads first", () => {
    const { lockFile } = cleared();
    holdMarked(lockFile);
    markSpawn(lockFile, at(NOW));
    expect(existsSync(startMarkFor(lockFile))).toBe(true);
    expect(daemonStart(lockFile, at(NOW))).toMatchObject({ kind: "locked", pid: process.pid });
  });

  it("goes once the daemon registers, and stays when a daemon lets go of its lock", () => {
    const { lockFile } = cleared();
    markSpawn(lockFile, at(NOW));
    holdMarked(lockFile);
    // A release: a hook may have spawned this daemon's successor.
    for (const lock of locks.splice(0)) lock.release();
    expect(existsSync(startMarkFor(lockFile))).toBe(false);
    expect(daemonStart(lockFile, at(NOW))).toMatchObject({ kind: "spawned" });
    // The registration (`#register`) removes both.
    holdMarked(lockFile);
    clearStartMark(lockFile);
    expect(existsSync(startMarkFor(lockFile))).toBe(false);
    expect(existsSync(spawnMarkFor(lockFile))).toBe(false);
  });
});

describe("a wait right after a hook's spawn (row 011-251, F1)", () => {
  it("judges a cleared record with a spawn mark as a start, and past its grace as a stopped daemon", () => {
    const { id, lockFile } = cleared();
    markSpawn(lockFile, at(NOW));
    const watch = watchDaemon(id, { lockFile });
    expect(watch.judge(null, at(NOW + 500))).toEqual({ state: "lapsed", locked: true });
    expect(watch.judge(null, at(NOW + DAEMON_START_GRACE_MS + 1))).toEqual({
      state: "down",
      reason: "stopped",
    });
  });

  it("named and pathless: go on to the deadline, and name no `squeal start`", async () => {
    const { repo, lockFile } = cleared();
    markSpawn(lockFile, at(NOW));

    const named = await run(["status", "--wait", "1500", A], repo.main);
    expect(named.code).toBe(3);
    expect(last(named.stdout)).toContain(`the deadline passed after 1.`);
    expect(last(named.stdout)).toContain(LOCKED_TEXT);
    expect(named.stdout).not.toContain("the daemon stopped");
    expect(named.stdout).not.toContain("squeal start");

    const plain = await run(["status", "--wait", "1500"], repo.main);
    expect(plain.code).toBe(0);
    expect(last(plain.stdout)).toMatch(/^Returned on timeout after 1\.\d s: /);
    expect(last(plain.stdout)).toContain(LOCKED_TEXT);
    expect(plain.stdout).not.toContain("squeal start");
  });
});

describe("plain status while a daemon starts (row 011-251, F2)", () => {
  const starts = [
    ["a daemon that holds the lock and marks its start", holdMarked],
    ["a hook's spawn mark", (lockFile: AbsolutePath) => markSpawn(lockFile, at(NOW - 2_000))],
  ] as const;

  for (const [what, start] of starts) {
    it(`with ${what}: the Outstanding line names it in place of \`squeal start\``, async () => {
      const { repo, lockFile } = cleared();
      start(lockFile);

      const result = await run(["status"], repo.main);

      expect(result.code).toBe(0);
      expect(noDaemonLine(result.stdout)).toMatch(
        new RegExp(
          `^ {2}no daemon has validated since \\S+; results are as of revision 4; ${LOCKED_TEXT}$`,
        ),
      );
      expect(result.stdout).not.toContain("squeal start");
    });

    it(`with ${what}: a named status names it, and the JSON adds only startingSince`, async () => {
      const { repo, lockFile } = cleared();
      const before = JSON.parse((await run(["status", "--json"], repo.main)).stdout);
      start(lockFile);

      const named = await run(["status", A], repo.main);
      expect(last(named.stdout)).toMatch(
        new RegExp(
          `^Named test files have no verdict at revision 4: no daemon has validated since \\S+; ${LOCKED_TEXT}`,
        ),
      );
      expect(named.stdout).not.toContain("squeal start");

      const after = JSON.parse((await run(["status", "--json"], repo.main)).stdout);
      expect(Object.keys(after.daemon).sort()).toEqual(
        [...Object.keys(before.daemon), "startingSince"].sort(),
      );
      expect(after.daemon).toMatchObject({ ...before.daemon, state: "down" });
      expect(typeof after.daemon.startingSince).toBe("number");
      expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    });
  }

  it("with a spawn mark past its grace, or none: names `squeal start` as before", async () => {
    const { repo, lockFile } = cleared();
    markSpawn(lockFile, at(NOW - DAEMON_START_GRACE_MS - 1));

    const result = await run(["status"], repo.main);
    expect(noDaemonLine(result.stdout)).toMatch(
      /^ {2}no daemon has validated since \S+; results are as of revision 4; `squeal start` starts one$/,
    );
    const json = JSON.parse((await run(["status", "--json"], repo.main)).stdout);
    expect(json.daemon.startingSince).toBeUndefined();
  });

  it("with a stale record and the lock held with no mark: a busy daemon, not a start", async () => {
    const { repo, lockFile } = cleared(true);
    const lock = acquireDaemonLock(lockFile);
    if (lock === null) throw new Error("the lock is taken");
    locks.push(lock);

    const result = await run(["status"], repo.main);

    expect(noDaemonLine(result.stdout)).toMatch(/; `squeal start` starts one$/);
    expect(result.stdout).not.toContain(LOCKED_TEXT);
    expect(
      JSON.parse((await run(["status", "--json"], repo.main)).stdout).daemon,
    ).not.toHaveProperty("startingSince");
  });

  it("with a stale record and another process's start marked: a start, and no death", async () => {
    // A daemon killed with its record left, and the one a hook spawned after it, holding the lock.
    const { repo, lockFile } = cleared(true);
    holdMarked(lockFile);

    const json = JSON.parse((await run(["status", "--json"], repo.main)).stdout);

    expect(json.daemon).toMatchObject({ state: "down" });
    expect(typeof json.daemon.startingSince).toBe("number");
    expect(json.daemon).not.toHaveProperty("died");
  });
});

describe("the hooks' header while a daemon starts (row 011-251, F2)", () => {
  it("says a daemon is starting, not that none validates, with either mark", () => {
    for (const start of [holdMarked, (path: AbsolutePath) => markSpawn(path, at(NOW))]) {
      const { store, id, lockFile } = cleared();
      const down = headerLines(readLiveHeader(store, id, at(NOW)), "squeal").join("\n");
      expect(down).toContain("No daemon has validated since");
      start(lockFile);

      const header = readLiveHeader(store, id, at(NOW));

      expect(header.daemon).toMatchObject({ state: "down", startingSince: expect.any(Number) });
      const text = headerLines(header, "squeal").join("\n");
      expect(text).toContain("A daemon is starting; results are as of revision 4.");
      expect(text).not.toContain("No daemon has validated");
      for (const lock of locks.splice(0)) lock.release();
    }
  });
});
