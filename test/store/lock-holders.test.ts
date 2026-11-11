import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import type { LockEntry } from "../../src/core/ps/source.js";
import {
  describeHolders,
  type HolderSource,
  holdersFrom,
  lockHolders,
} from "../../src/core/store/lock-holders.js";
import { tempDir } from "./helpers.js";

/*
 * Spec 021 D5 (row 021-10): `lockHolders` names who holds or waits for a
 * store's write lock from `/proc/locks`, on byte 120 of its `-shm` file,
 * without opening the database. A second process holds `BEGIN IMMEDIATE`
 * on a real file; the rest runs over a fake `/proc/locks`.
 */

/** Holds the write lock of the WAL database at argv[1] until its input ends. */
const HOLDER = `
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1]);
db.exec("PRAGMA journal_mode = WAL");
db.exec("CREATE TABLE IF NOT EXISTS t (x)");
db.exec("BEGIN IMMEDIATE");
db.exec("INSERT INTO t VALUES (1)");
process.stdout.write("held\\n");
process.stdin.on("end", () => { db.exec("COMMIT"); db.close(); });
process.stdin.resume();
`;

const children: ChildProcessWithoutNullStreams[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

/** A WAL database at a temporary path whose `-shm` file exists, as a daemon's store has. */
function walDatabase(): { path: string; reader: DatabaseSync } {
  const path = join(tempDir("squeal-lock-holders-"), "store.sqlite");
  const reader = new DatabaseSync(path);
  reader.exec("PRAGMA journal_mode = WAL");
  reader.exec("CREATE TABLE IF NOT EXISTS t (x)");
  return { path, reader };
}

async function holdWriteLock(path: string): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(process.execPath, [
    "--disable-warning=ExperimentalWarning",
    "-e",
    HOLDER,
    path,
  ]);
  children.push(child);
  let out = "";
  child.stdout.setEncoding("utf8");
  for await (const chunk of child.stdout) {
    out += chunk;
    if (out.includes("held\n")) return child;
  }
  throw new Error(`the holder exited before it held the lock: ${out}`);
}

describe.runIf(process.platform === "linux")("on Linux, against a real holder", () => {
  test("a second process in BEGIN IMMEDIATE is named by its pid and command", async () => {
    const { path, reader } = walDatabase();
    const child = await holdWriteLock(path);

    const holders = lockHolders(path);

    expect(holders).toEqual([
      { pid: child.pid, command: expect.stringMatching(/^node /), waiting: false },
    ]);
    expect(describeHolders(holders)).toMatch(new RegExp(`^held by pid ${child.pid} \\(node `));
    child.stdin.end();
    await once(child, "exit");
    reader.close();
  });

  test("once the holder commits, nobody holds it", async () => {
    const { path, reader } = walDatabase();
    const child = await holdWriteLock(path);
    child.stdin.end();
    await once(child, "exit");

    expect(lockHolders(path)).toEqual([]);
    reader.close();
  });

  test("a database without a -shm file has no holder", () => {
    expect(lockHolders(join(tempDir("squeal-lock-holders-"), "store.sqlite"))).toEqual([]);
  });
});

describe("elsewhere", () => {
  test("a platform without /proc/locks gives undefined", () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
    try {
      expect(lockHolders("/nowhere/store.sqlite")).toBeUndefined();
    } finally {
      if (platform !== undefined) Object.defineProperty(process, "platform", platform);
    }
  });
});

const SHM = "/work/.git/squeal/store.sqlite-shm";
const KEY = "103:02:4477078";

function entry(overrides: Partial<LockEntry>): LockEntry {
  return {
    kind: "POSIX",
    access: "write",
    pid: 100,
    file: KEY,
    blocked: false,
    start: 120,
    end: 120,
    ...overrides,
  };
}

function fakeSource(
  locks: readonly LockEntry[] | null,
  commands: Readonly<Record<number, readonly string[]>> = {},
  keys: Readonly<Record<string, string>> = { [SHM]: KEY },
): HolderSource {
  return {
    locks: () => locks,
    fileKey: (path) => keys[path] ?? null,
    cmdline: (pid) => commands[pid] ?? null,
  };
}

describe("over /proc/locks", () => {
  const DAEMON = [
    "squeal squeal daemon @9a7f9813",
    "/home/user/.claude/plugins/cache/hearsay/squeal/0.1.432/dist/cli/squeal.mjs",
    "daemon",
    "/work/a",
  ];
  const HOOK = [
    "/home/user/.nvm/versions/node/v24.22.1/bin/node",
    "--disable-warning=ExperimentalWarning",
    "/home/user/.claude/plugins/cache/hearsay/squeal/0.1.432/dist/hooks/post-tool-batch.mjs",
  ];

  test("the holder of byte 120 comes first, then each waiter, with short commands", () => {
    const source = fakeSource(
      [
        entry({ pid: 300, blocked: true }),
        entry({ pid: 200 }),
        entry({ pid: 400, blocked: true, access: "read" }),
      ],
      { 200: DAEMON, 300: HOOK },
    );

    expect(holdersFrom(source, "/work/.git/squeal/store.sqlite")).toEqual([
      {
        pid: 200,
        command: "squeal squeal daemon @9a7f9813 squeal.mjs daemon /work/a",
        waiting: false,
      },
      {
        pid: 300,
        command: "node --disable-warning=ExperimentalWarning post-tool-batch.mjs",
        waiting: true,
      },
      { pid: 400, command: "command unknown", waiting: true },
    ]);
  });

  test("locks on other bytes, other files, read locks, flock, open file locks and no range name nobody", () => {
    const { start: _start, end: _end, ...noRange } = entry({ pid: 6 });
    const source = fakeSource([
      entry({ pid: 1, start: 128, end: 128, access: "read" }),
      entry({ pid: 2, start: 121, end: 127 }),
      entry({ pid: 3, file: "103:02:9999" }),
      entry({ pid: 4, access: "read" }),
      entry({ pid: 5, kind: "FLOCK", start: 0, end: null }),
      entry({ pid: null, kind: "OFDLCK" }),
      noRange,
    ]);

    expect(holdersFrom(source, "/work/.git/squeal/store.sqlite")).toEqual([]);
  });

  test("a POSIX range that covers byte 120 holds it", () => {
    const source = fakeSource([
      entry({ pid: 7, start: 0, end: null }),
      entry({ pid: 8, start: 120, end: 127 }),
    ]);

    expect(holdersFrom(source, "/work/.git/squeal/store.sqlite")?.map((h) => h.pid)).toEqual([
      7, 8,
    ]);
  });

  test("the device is matched when it agrees, and only the inode when no entry has it", () => {
    const overlay = fakeSource([entry({ pid: 9, file: "00:2c:4477078" })]);
    const both = fakeSource([entry({ pid: 9, file: "00:2c:4477078" }), entry({ pid: 10 })]);

    expect(holdersFrom(overlay, "/work/.git/squeal/store.sqlite")?.map((h) => h.pid)).toEqual([9]);
    expect(holdersFrom(both, "/work/.git/squeal/store.sqlite")?.map((h) => h.pid)).toEqual([10]);
  });

  test("an unreadable /proc/locks gives undefined; a missing -shm file, nobody", () => {
    expect(holdersFrom(fakeSource(null), "/work/.git/squeal/store.sqlite")).toBeUndefined();
    expect(holdersFrom(fakeSource([entry({})], {}, {}), "/nowhere/store.sqlite")).toEqual([]);
  });

  test("a long command line is cut to one message line", () => {
    const long = ["/usr/bin/node", "squeal.mjs", "hold", "--", ...Array(60).fill("word")];
    const [holder] =
      holdersFrom(fakeSource([entry({})], { 100: long }), "/work/.git/squeal/store.sqlite") ?? [];

    expect(holder?.command.length).toBe(160);
    expect(holder?.command).toMatch(/^node squeal\.mjs hold -- word .*\.\.\.$/);
  });
});
