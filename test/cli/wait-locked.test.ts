import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { lockHeld, watchDaemon } from "../../src/cli/wait-liveness.js";
import { acquireDaemonLock, type DaemonLock } from "../../src/core/daemon/lock.js";
import { LOCKED_TEXT } from "../../src/core/status/outstanding-text.js";
import { lockFileFor } from "../../src/core/store/index.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../../src/core/types/index.js";
import { A, NOW, repoWith } from "./status-wait-fixture.js";

/*
 * Row 011-250 (gh-1, `research/issue-1.md` open question 1): after a signal
 * stop clears the daemon's record, the daemon a hook spawned holds the lock
 * while it opens the store, and registers only then. A wait read the cleared
 * record as a stopped daemon at once and named `squeal start`. With the lock
 * held it goes on; at its deadline it says a daemon holds the lock.
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
  letGo();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

/** A worktree whose daemon cleared its record, and the path of its daemon lock. */
function cleared() {
  const { repo, store } = repoWith([A]);
  const id = repo.mainId as WorktreeId;
  store.worktrees.setDaemon(id, null);
  return { repo, id, lockFile: lockFileFor(repo.commonDir as AbsolutePath, id) };
}

/** Lets go of every lock `hold` took. */
function letGo(): void {
  for (const lock of locks.splice(0)) lock.release();
}

/** Holds the daemon lock at `path`, as a starting daemon does, until the test ends. */
function hold(path: AbsolutePath): void {
  const lock = acquireDaemonLock(path);
  if (lock === null) throw new Error("the lock is taken");
  locks.push(lock);
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

describe("a wait's lock probe (row 011-250)", () => {
  it("reads a held lock as held, and leaves it to its holder", () => {
    const { lockFile } = cleared();
    hold(lockFile);
    expect(lockHeld(lockFile)).toBe(true);
    letGo();
    expect(lockHeld(lockFile)).toBe(false);
    // The probe released what it took: a daemon takes the lock after it.
    hold(lockFile);
  });

  it("reads no path, no file, and a take that throws as not held", () => {
    const dir = mkdtempSync("/tmp/sq-");
    try {
      const unreadable = join(dir, "lock.sqlite");
      mkdirSync(unreadable);
      expect(lockHeld(undefined)).toBe(false);
      expect(lockHeld(join(dir, "none.sqlite") as AbsolutePath)).toBe(false);
      expect(lockHeld(unreadable as AbsolutePath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("judges a cleared record lapsed while the lock is held, stopped once it is free", () => {
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
