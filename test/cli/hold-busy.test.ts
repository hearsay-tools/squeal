import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOLD_NOT_STARTED, holdCommand } from "../../src/cli/hold.js";
import type { CliIo } from "../../src/cli/main.js";
import { readCommandHolds } from "../../src/core/scheduler/hold-rows.js";
import { storePaths } from "../../src/core/store/paths.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { DaemonRequest } from "../../src/core/types/daemon.js";
import { fakeRepo, seedStore } from "../status/helpers.js";
import { holdLock, type LockHolder } from "../status/hold-lock.js";
import { busyClause, line } from "./busy-lines.js";

/*
 * Spec 021 D1 (row 021-07, #162, #186): `squeal hold` asks a store another
 * process holds again until its bound. Within it the command runs on hold;
 * past it the command does not start, the wrapper exits `HOLD_NOT_STARTED`
 * and its message names the lock's holder through `describeHolders`. Where
 * `lockHolders` has no source yet (row 021-10's stub, or not Linux), the
 * holder below stands in for it with the pid of the process that holds.
 */

const named = vi.hoisted(() => ({ pid: 0, asked: [] as string[] }));
vi.mock("../../src/core/store/lock-holders.js", async (original) => {
  const real = await original<typeof import("../../src/core/store/lock-holders.js")>();
  return {
    ...real,
    lockHolders: (database: string) => {
      named.asked.push(database);
      const stand = { pid: named.pid, command: "the test's lock holder", waiting: false };
      return real.lockHolders(database) ?? [stand];
    },
  };
});

const holders: LockHolder[] = [];
afterEach(async () => {
  for (const holder of holders.splice(0)) {
    holder.child.kill();
    await holder.released;
  }
  named.asked.length = 0;
});

/** A store, and a second process that holds its write lock for `holdMs`. */
async function held(holdMs: number) {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const database = storePaths(repo.commonDir).database;
  const holder = await holdLock(database, "immediate", holdMs);
  holders.push(holder);
  named.pid = holder.child.pid ?? 0;
  return {
    root: repo.main as AbsolutePath,
    database,
    holds: () => readCommandHolds(store, repo.mainId),
    holder,
  };
}

async function hold(argv: string[], cwd: string, busyBoundMs?: number) {
  let stderr = "";
  const asked: DaemonRequest["type"][] = [];
  const io: CliIo = {
    stdout: () => {},
    stderr: (text) => {
      stderr += text;
    },
    cwd,
    env: {},
  };
  const ask = async (_root: AbsolutePath, request: DaemonRequest) => {
    asked.push(request.type);
    return null;
  };
  const started = Date.now();
  const deps = busyBoundMs === undefined ? { ask } : { ask, busyBoundMs };
  const code = await holdCommand(argv, io, deps);
  return { code, stderr, asked, tookMs: Date.now() - started };
}

describe("squeal hold beside a store another process holds (spec 021 D1)", {
  timeout: 30_000,
}, () => {
  it("holds and runs the command when the lock is freed within the bound, past one busy timeout", async () => {
    const { root, holds } = await held(1_500);
    const ran = join(root, "ran");

    const out = await hold(["--", "touch", ran], root);

    expect(out.code).toBe(0);
    expect(out.stderr).toMatch(/^squeal: validation of .* is on hold until `touch .*` exits/);
    expect(out.stderr).not.toContain("nothing is on hold");
    expect(existsSync(ran)).toBe(true);
    // The hold's former busy timeout was 1 s: one try would have failed (#162).
    expect(out.tookMs).toBeGreaterThanOrEqual(1_000);
    expect(holds()).toEqual([]);
  });

  it("does not start the command past the bound, exits 125 and names the holder", async () => {
    const { root, database, holds, holder } = await held(30_000);
    const ran = join(root, "ran");

    const out = await hold(["--", "touch", ran], root, 400);

    expect(out.code).toBe(HOLD_NOT_STARTED);
    expect(HOLD_NOT_STARTED).toBe(125);
    expect(out.stderr).toMatch(
      line(
        `squeal hold: nothing is on hold and \`touch ${ran}\` did not start: ` +
          `${busyClause(holder.child.pid)}; run it again`,
      ),
    );
    expect(named.asked).toContain(database);
    expect(existsSync(ran)).toBe(false);
    expect(out.asked).toEqual([]);
    holder.child.kill();
    await holder.released;
    expect(holds()).toEqual([]);
  });

  it("says so when the lock is taken while the command runs: its process and its removal are not recorded", async () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const database = storePaths(repo.commonDir).database;
    const root = repo.main as AbsolutePath;
    // Taken once the entry is written, when the daemon is asked to hold; freed after the wrapper exits.
    const lock = new DatabaseSync(database);
    named.pid = process.pid;
    let stderr = "";
    const io: CliIo = {
      stdout: () => {},
      stderr: (text) => {
        stderr += text;
      },
      cwd: root,
      env: {},
    };
    const ask = async (_root: AbsolutePath, request: DaemonRequest) => {
      if (request.type === "hold") lock.exec("BEGIN IMMEDIATE");
      return null;
    };

    try {
      const code = await holdCommand(["--", "sh", "-c", "exit 3"], io, { ask, busyBoundMs: 200 });
      expect(code).toBe(3);
    } finally {
      lock.exec("ROLLBACK");
      lock.close();
    }
    const busy = busyClause(process.pid);
    expect(stderr).toMatch(
      line(
        `squeal hold: could not record \`sh -c exit 3\`'s process in its hold: ${busy}; ` +
          "the hold ends with this wrapper",
      ),
    );
    expect(stderr).toMatch(
      line(
        `squeal hold: could not remove the hold: ${busy}; ` +
          "the daemon removes it once `sh -c exit 3` is gone",
      ),
    );
    // Left for the daemon's heartbeat, which removes it once the wrapper and the command are gone.
    expect(readCommandHolds(store, repo.mainId)).toMatchObject([
      { command: "sh -c exit 3", child: null },
    ]);
  });
});

describe("squeal hold when its entry's write fails (review 0.1.434 B1)", () => {
  it("does not start the command, exits 125 and says why, as for a busy store", async () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    // Any write the store refuses that is not a busy lock, as a full disk refuses it.
    const db = new DatabaseSync(storePaths(repo.commonDir).database);
    db.exec(
      "CREATE TRIGGER reject_meta BEFORE INSERT ON meta BEGIN SELECT RAISE(ABORT, 'write rejected'); END",
    );
    db.close();
    const ran = join(repo.main, "ran");

    const out = await hold(["--", "touch", ran], repo.main);

    expect(out.code).toBe(HOLD_NOT_STARTED);
    expect(out.stderr).toBe(
      `squeal hold: nothing is on hold and \`touch ${ran}\` did not start: ` +
        "its Squeal store could not be written (write rejected)\n",
    );
    expect(existsSync(ran)).toBe(false);
    expect(out.asked).toEqual([]);
    expect(readCommandHolds(store, repo.mainId)).toEqual([]);
  });
});
