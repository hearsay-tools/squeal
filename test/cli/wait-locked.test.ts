import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { watchDaemon } from "../../src/cli/wait-liveness.js";
import { acquireDaemonLock, type DaemonLock } from "../../src/core/daemon/lock.js";
import { markStart, startMarked, startMarkFor } from "../../src/core/daemon/start-mark.js";
import { lifeOf } from "../../src/core/daemon/terminate.js";
import { LOCKED_TEXT } from "../../src/core/status/outstanding-text.js";
import { lockFileFor } from "../../src/core/store/index.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../../src/core/types/index.js";
import { A, NOW, repoWith } from "./status-wait-fixture.js";

/*
 * Row 011-250 (gh-1, `research/issue-1.md` open question 1): after a signal
 * stop clears the daemon's record, the daemon a hook spawned holds the lock
 * while it opens the store, and registers only then. A wait read the cleared
 * record as a stopped daemon at once and named `squeal start`. While that
 * daemon marks its start it goes on; at its deadline it says a daemon holds
 * the lock. Review 0.1.350, B1: the wait reads the mark and takes no lock.
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

/** A worktree whose daemon cleared its record, and the path of its daemon lock, its directory made. */
function cleared() {
  const { repo, store } = repoWith([A]);
  const id = repo.mainId as WorktreeId;
  store.worktrees.setDaemon(id, null);
  const lockFile = lockFileFor(repo.commonDir as AbsolutePath, id);
  mkdirSync(dirname(lockFile), { recursive: true });
  return { repo, id, lockFile };
}

/** Lets go of every lock `hold` took. */
function letGo(): void {
  for (const lock of locks.splice(0)) lock.release();
}

/**
 * Holds the daemon lock at `path` until the test ends, as a starting daemon
 * does: with its start marked, or with `marked: false` as a daemon older
 * than the mark, or one stopping.
 */
function hold(path: AbsolutePath, { marked = true } = {}): void {
  const lock = acquireDaemonLock(path);
  if (lock === null) throw new Error("the lock is taken");
  locks.push(marked ? markStart(path, lock) : lock);
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

describe("a wait's reading of a daemon's start mark (row 011-250; review 0.1.350, B1)", () => {
  it("reads a start this process marks, and none once its lock goes", () => {
    const { lockFile } = cleared();
    hold(lockFile);
    expect(startMarked(lockFile)).toBe(true);
    letGo();
    expect(startMarked(lockFile)).toBe(false);
    // The release removed the mark, and let go of the lock.
    hold(lockFile);
  });

  it("reads no mark, one that cannot be read or parsed, and one whose process is gone as none", () => {
    const { lockFile } = cleared();
    const mark = startMarkFor(lockFile);
    expect(startMarked(lockFile)).toBe(false);
    for (const text of ["", "not json", "null", "{}", '{"pid":"1"}', '{"pid":0}', '{"pid":-1}']) {
      writeFileSync(mark, text);
      expect(startMarked(lockFile), text).toBe(false);
    }
    // A process this test started, already gone.
    const gone = spawnSync(process.execPath, ["-e", ""]).pid;
    writeFileSync(mark, JSON.stringify({ pid: gone, startTime: 1 }));
    expect(startMarked(lockFile)).toBe(false);
    rmSync(mark);
    mkdirSync(mark);
    expect(startMarked(lockFile)).toBe(false);
  });

  it.runIf(process.platform === "linux")(
    "reads a live pid with another start time as none: the pid was reused",
    () => {
      const { lockFile } = cleared();
      const start = lifeOf(process.pid)?.start ?? 0;
      writeFileSync(
        startMarkFor(lockFile),
        JSON.stringify({ pid: process.pid, startTime: start + 1 }),
      );
      expect(startMarked(lockFile)).toBe(false);
      writeFileSync(startMarkFor(lockFile), JSON.stringify({ pid: process.pid, startTime: start }));
      expect(startMarked(lockFile)).toBe(true);
    },
  );

  it("judges a cleared record lapsed while a start is marked, stopped without one", () => {
    const { id, lockFile } = cleared();
    const watch = watchDaemon(id, { lockFile });
    hold(lockFile);
    expect(watch.judge(null, NOW as EpochMs)).toEqual({ state: "lapsed", locked: true });
    letGo();
    expect(watch.judge(null, NOW as EpochMs)).toEqual({ state: "down", reason: "stopped" });
    // Without the lock's path, as before: a cleared record is a stopped daemon.
    hold(lockFile);
    expect(watchDaemon(id).judge(null, NOW as EpochMs)).toEqual({
      state: "down",
      reason: "stopped",
    });
  });

  it("reads a held lock with no mark as before row 011-250, and runs no SQL to judge", () => {
    // A daemon older than the mark, starting, or one stopping after it cleared its record.
    const { id, lockFile } = cleared();
    hold(lockFile, { marked: false });
    const exec = vi.spyOn(DatabaseSync.prototype, "exec");
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
    const watch = watchDaemon(id, { lockFile });
    expect(watch.judge(null, NOW as EpochMs)).toEqual({ state: "down", reason: "stopped" });
    expect(exec).not.toHaveBeenCalled();
    letGo();
    hold(lockFile);
    exec.mockClear();
    expect(watch.judge(null, NOW as EpochMs)).toEqual({ state: "lapsed", locked: true });
    expect(exec).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe("a wait with no daemon record while a daemon holds the lock (row 011-250)", () => {
  it("named: goes on to its deadline, exits 3 and says a daemon holds the lock", async () => {
    const { repo, lockFile } = cleared();
    hold(lockFile);

    const result = await run(["status", "--wait", "1500", A], repo.main);

    expect(result.code).toBe(3);
    expect(last(result.stdout)).toMatch(
      new RegExp(
        `^Named test files have no verdict: the deadline passed after 1\\.\\d s: ${LOCKED_TEXT}; results are as of revision 4\\. Worktree: .*\\. A later pass is not reported\\. A failure arrives with a later tool call\\. For the verdict, wait again: \`squeal status --wait 1500 ${A}\`$`,
      ),
    );
    expect(last(result.stdout)).not.toContain("squeal start");
  });

  it("named --json: the reason stays lapsed", async () => {
    const { repo, lockFile } = cleared();
    hold(lockFile);

    const result = await run(["status", "--json", "--wait", "1500", A], repo.main);

    expect(result.code).toBe(3);
    expect(JSON.parse(result.stdout).selection).toMatchObject({
      outcome: "timeout",
      result: "none",
      reason: "lapsed",
    });
    expect(last(result.stderr)).toContain(LOCKED_TEXT);
  });

  it("pathless: goes on to its deadline and says the same wait gets the result once it serves", async () => {
    const { repo, lockFile } = cleared();
    hold(lockFile);

    const result = await run(["status", "--wait", "1500"], repo.main);

    expect(result.code).toBe(0);
    expect(last(result.stdout)).toMatch(
      new RegExp(
        `^Returned on timeout after 1\\.\\d s: .* at revision 4; ${LOCKED_TEXT}, so the wait went on; the same wait run again gets the result once it serves\\. Worktree: `,
      ),
    );
    expect(last(result.stdout)).not.toContain("squeal start");
  });
});

/** The `Outstanding:` group line that says no daemon validates. */
const noDaemonLine = (text: string) =>
  text.split("\n").find((line) => line.startsWith("  no daemon has validated"));

describe("the Outstanding line above a wait's verdict (row 011-250)", () => {
  it("names the held lock in place of `squeal start`, pathless and named --full", async () => {
    const { repo, lockFile } = cleared();
    hold(lockFile);

    for (const argv of [
      ["status", "--wait", "1500"],
      ["status", "--full", "--wait", "1500", A],
    ]) {
      const result = await run(argv, repo.main);
      expect(noDaemonLine(result.stdout)).toMatch(
        new RegExp(
          `^ {2}no daemon has validated since \\S+; results are as of revision 4; ${LOCKED_TEXT}$`,
        ),
      );
      expect(result.stdout).not.toContain("squeal start");
    }
  });

  it("with the lock free, names `squeal start` as before", async () => {
    const { repo } = cleared();

    const result = await run(["status", "--wait", "1500"], repo.main);
    expect(noDaemonLine(result.stdout)).toMatch(
      /^ {2}no daemon has validated since \S+; results are as of revision 4; `squeal start` starts one$/,
    );
  });
});

describe("a wait with no daemon record and the lock free (row 011-250)", () => {
  it("returns at once without a daemon, as before", async () => {
    const { repo } = cleared();

    const named = await run(["status", "--wait", "1500", A], repo.main);
    expect(named.code).toBe(3);
    expect(last(named.stdout)).toMatch(
      /^Named test files have no verdict: no daemon has validated since .*: the daemon stopped; results are as of revision 4; `squeal start` starts one/,
    );
    const plain = await run(["status", "--wait", "1500"], repo.main);
    expect(plain.code).toBe(0);
    expect(last(plain.stdout)).toMatch(
      /^Returned without a daemon: no daemon has validated since .*: the daemon stopped; results are as of revision 4\. /,
    );
  });
});
