import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireDaemonLock, type DaemonLock } from "../../src/core/daemon/lock.js";
import {
  clearStartMark,
  DAEMON_START_GRACE_MS,
  daemonStart,
  markSpawn,
  markStart,
  spawnMarkFor,
  startMarkFor,
} from "../../src/core/presence/index.js";
import type { AbsolutePath, EpochMs } from "../../src/core/types/index.js";
import { NOW } from "./fixture.js";

/*
 * Row 011-251 (F1), moved from `test/cli/start-readers.test.ts` by row
 * 011-293: a hook that spawns a daemon writes a spawn mark before the daemon
 * can take the lock (`markSpawn`); daemon presence reads it (`daemonStart`).
 */

const at = (ms: number) => ms as EpochMs;

const dirs: string[] = [];
const locks: DaemonLock[] = [];
afterEach(() => {
  for (const lock of locks.splice(0)) lock.release();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A lock file's path in a scratch locks directory. */
function lockFile(): AbsolutePath {
  const dir = mkdtempSync("/tmp/sq-marks-");
  dirs.push(dir);
  return join(dir, "daemon.lock") as AbsolutePath;
}

/** Holds the lock at `path` as a starting daemon does, its start marked, until the test ends. */
function holdMarked(path: AbsolutePath): void {
  const lock = acquireDaemonLock(path);
  if (lock === null) throw new Error("the lock is taken");
  locks.push(markStart(path, lock));
}

describe("a hook's spawn mark (row 011-251, F1)", () => {
  it("reads for DAEMON_START_GRACE_MS of its time, and not past it", () => {
    const file = lockFile();
    expect(daemonStart(file, at(NOW))).toBeNull();
    markSpawn(file, at(NOW), null);
    expect(daemonStart(file, at(NOW))).toEqual({ kind: "spawned", since: NOW });
    expect(daemonStart(file, at(NOW + DAEMON_START_GRACE_MS))).toMatchObject({
      kind: "spawned",
    });
    expect(daemonStart(file, at(NOW + DAEMON_START_GRACE_MS + 1))).toBeNull();
    // A clock set back reads it for as long.
    expect(daemonStart(file, at(NOW - DAEMON_START_GRACE_MS - 1))).toBeNull();
  });

  it("keeps the first spawn's time while no heartbeat came after it, so failing starts lapse", () => {
    const file = lockFile();
    markSpawn(file, at(NOW), at(NOW - 1_000));
    markSpawn(file, at(NOW + 5_000), at(NOW - 1_000));
    markSpawn(file, at(NOW + DAEMON_START_GRACE_MS + 1), null);
    expect(daemonStart(file, at(NOW + DAEMON_START_GRACE_MS + 1))).toBeNull();
    // A heartbeat after it: a daemon came up since, and the next spawn is a start of its own.
    markSpawn(file, at(NOW + 20_000), at(NOW + 15_000));
    expect(daemonStart(file, at(NOW + 20_000))).toEqual({ kind: "spawned", since: NOW + 20_000 });
  });

  it("reads none at or before the last heartbeat a reader knows, as a told start", () => {
    const file = lockFile();
    markSpawn(file, at(NOW), null);
    expect(daemonStart(file, at(NOW + 1), at(NOW - 1))).toMatchObject({ kind: "spawned" });
    expect(daemonStart(file, at(NOW + 1), at(NOW))).toBeNull();
    expect(daemonStart(file, at(NOW + 1), at(NOW + 1))).toBeNull();
  });

  it("reads one that cannot be read or parsed as none", () => {
    const file = lockFile();
    const mark = spawnMarkFor(file);
    for (const text of ["", "not json", "null", "{}", '{"at":"1"}', '{"at":null}']) {
      writeFileSync(mark, text);
      expect(daemonStart(file, at(NOW)), text).toBeNull();
    }
    rmSync(mark);
    mkdirSync(mark);
    expect(daemonStart(file, at(NOW))).toBeNull();
  });

  it("is never written over the start mark, which a holder's start reads first", () => {
    const file = lockFile();
    holdMarked(file);
    markSpawn(file, at(NOW), null);
    expect(existsSync(startMarkFor(file))).toBe(true);
    expect(daemonStart(file, at(NOW))).toMatchObject({ kind: "locked", pid: process.pid });
  });

  it("goes once the daemon registers, and stays when a daemon lets go of its lock", () => {
    const file = lockFile();
    markSpawn(file, at(NOW), null);
    holdMarked(file);
    // A release: a hook may have spawned this daemon's successor.
    for (const lock of locks.splice(0)) lock.release();
    expect(existsSync(startMarkFor(file))).toBe(false);
    expect(daemonStart(file, at(NOW))).toMatchObject({ kind: "spawned" });
    // The registration (`#register`) removes both.
    holdMarked(file);
    clearStartMark(file);
    expect(existsSync(startMarkFor(file))).toBe(false);
    expect(existsSync(spawnMarkFor(file))).toBe(false);
  });
});
