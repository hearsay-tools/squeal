import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { watchDaemon } from "../../src/cli/wait-liveness.js";
import { acquireDaemonLock, type DaemonLock } from "../../src/core/daemon/lock.js";
import { markSpawn, markStart } from "../../src/core/daemon/start-mark.js";
import { LOCKED_TEXT, SPAWNED_TEXT } from "../../src/core/status/outstanding-text.js";
import { lockFileFor } from "../../src/core/store/index.js";
import type {
  AbsolutePath,
  DaemonRecord,
  EpochMs,
  WorktreeId,
} from "../../src/core/types/index.js";
import { A, NOW, repoWith } from "./status-wait-fixture.js";

/*
 * Review 0.1.355 B1, its wait (011 C9 as amended 2026-10-26, row 011-251):
 * a daemon killed with its record left, and the one a hook spawned in its
 * place, which holds the lock and marks its start before it opens the
 * store. The wait reads the marks as status does (`marksAt`): a live start
 * mark is a daemon starting, so the wait goes on and says so at its
 * deadline. A spawn mark alone is no start with a stale record, as in
 * status: the wait reads it as before. No lock is taken.
 */

const saved = { ...process.env };
let runtimeDir: string;
const locks: DaemonLock[] = [];
beforeEach(() => {
  // Socket paths are limited to 108 bytes; the test temp dir can be longer.
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
});
afterEach(() => {
  vi.restoreAllMocks();
  letGo();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

/** A worktree at revision 4 whose daemon left its record with a heartbeat a minute old. */
function stale() {
  const { repo, store } = repoWith([A]);
  const id = repo.mainId as WorktreeId;
  const record = store.worktrees.get(id)?.daemon;
  if (!record) throw new Error("no record");
  const left: DaemonRecord = { ...record, heartbeatAt: (NOW - 60_000) as EpochMs };
  store.worktrees.setDaemon(id, left);
  const lockFile = lockFileFor(repo.commonDir as AbsolutePath, id);
  mkdirSync(dirname(lockFile), { recursive: true });
  return { repo, id, lockFile, record: left };
}

/** Holds the daemon lock at `path` with its start marked, as the replacement does, until let go. */
function holdMarked(path: AbsolutePath): void {
  const lock = acquireDaemonLock(path);
  if (lock === null) throw new Error("the lock is taken");
  locks.push(markStart(path, lock));
}

function letGo(): void {
  for (const lock of locks.splice(0)) lock.release();
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
/** A wait's text without its times, which differ from run to run. */
const timeless = (text: string) => text.replace(/\d+(\.\d+)? s\b/g, "<t> s");

describe("a wait's judge with a stale record and a replacement's marks (review 0.1.355 B1)", () => {
  it("is lapsed and locked while the start is marked, takes no lock, and is down once it failed", async () => {
    const { id, lockFile, record } = stale();
    holdMarked(lockFile);
    const watch = watchDaemon(id, { lockFile, downMs: 0 });
    const exec = vi.spyOn(DatabaseSync.prototype, "exec");

    expect(watch.judge(record, NOW as EpochMs)).toEqual({ state: "lapsed", locked: true });
    expect(watch.judge(record, NOW as EpochMs)).toEqual({ state: "lapsed", locked: true });
    expect(exec.mock.calls.flat().join("\n")).not.toMatch(/EXCLUSIVE/i);

    // The start failed: its mark goes with the lock, and the dead socket is read as before.
    letGo();
    await vi.waitFor(() =>
      expect(watch.judge(record, NOW as EpochMs)).toEqual({ state: "down", reason: "silent" }),
    );
  });

  it("with a spawn mark alone: no start, the dead socket read as before", async () => {
    const { id, lockFile, record } = stale();
    markSpawn(lockFile, (NOW - 500) as EpochMs, null);
    const watch = watchDaemon(id, { lockFile, downMs: 0 });

    expect(watch.judge(record, NOW as EpochMs)).toEqual({ state: "lapsed" });
    await vi.waitFor(() =>
      expect(watch.judge(record, NOW as EpochMs)).toEqual({ state: "down", reason: "silent" }),
    );
  });
});

describe("a wait with a stale record while its replacement marks its start (review 0.1.355 B1)", () => {
  it("named: goes on to its deadline, exits 3 and says a daemon holds the lock", async () => {
    const { repo, lockFile } = stale();
    holdMarked(lockFile);

    const result = await run(["status", "--wait", "1500", A], repo.main);

    expect(result.code).toBe(3);
    expect(last(result.stdout)).toMatch(
      new RegExp(
        `^Named test files have no verdict: the deadline passed after 1\\.\\d s: ${LOCKED_TEXT}; results are as of revision 4\\. `,
      ),
    );
    expect(result.stdout).not.toContain("squeal start");
  });

  it("named --json: the reason is lapsed", async () => {
    const { repo, lockFile } = stale();
    holdMarked(lockFile);

    const result = await run(["status", "--json", "--wait", "1500", A], repo.main);

    expect(result.code).toBe(3);
    expect(JSON.parse(result.stdout).selection).toMatchObject({
      outcome: "timeout",
      result: "none",
      reason: "lapsed",
    });
    expect(last(result.stderr)).toContain(LOCKED_TEXT);
  });

  it("pathless: goes on to its deadline, exits 0 and says the same wait gets the result once it serves", async () => {
    const { repo, lockFile } = stale();
    holdMarked(lockFile);

    const result = await run(["status", "--wait", "1500"], repo.main);

    expect(result.code).toBe(0);
    expect(last(result.stdout)).toMatch(
      new RegExp(
        `^Returned on timeout after 1\\.\\d s: .* at revision 4; ${LOCKED_TEXT}, so the wait went on; the same wait run again gets the result once it serves\\. `,
      ),
    );
    expect(result.stdout).not.toContain("squeal start");
  });

  it("with a spawn mark alone: named and pathless read as with no mark", async () => {
    for (const argv of [
      ["status", "--wait", "1500", A],
      ["status", "--wait", "1500"],
    ]) {
      const before = stale();
      const unmarked = await run(argv, before.repo.main);
      const { repo, lockFile } = stale();
      markSpawn(lockFile, (NOW - 500) as EpochMs, null);

      const spawned = await run(argv, repo.main);

      expect(spawned.code).toBe(unmarked.code);
      expect(timeless(last(spawned.stdout)).replaceAll(repo.main, "<root>")).toBe(
        timeless(last(unmarked.stdout)).replaceAll(before.repo.main, "<root>"),
      );
      expect(spawned.stdout).not.toContain(LOCKED_TEXT);
      expect(spawned.stdout).not.toContain(SPAWNED_TEXT);
    }
  });
});
