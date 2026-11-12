import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import type { LockEntry } from "../../src/core/ps/source.js";
import {
  describeHolders,
  type HolderSource,
  refusedHoldersFrom,
  refusedLockHolders,
} from "../../src/core/store/lock-holders.js";
import { tempDir } from "./helpers.js";

/*
 * Row 020-37 (spec 021 D5): after the store refused a write, a holder
 * exists, but one read of `/proc/locks` can miss it under load (020-30's
 * run at load 72). `refusedLockHolders` reads again, a bounded number of
 * times, until a read names the holder. A fake `/proc/locks` gives each
 * read its own answer.
 */

const DATABASE = "/work/.git/squeal/store.sqlite";
const KEY = "103:02:4477078";

function entry(overrides: Partial<LockEntry>): LockEntry {
  return {
    kind: "POSIX",
    access: "write",
    pid: 200,
    file: KEY,
    blocked: false,
    start: 120,
    end: 120,
    ...overrides,
  };
}

/** A source whose n-th read of `/proc/locks` gives `reads[n]`, the last one from then on. */
function readsInTurn(reads: readonly (readonly LockEntry[] | null)[]) {
  let count = 0;
  const source: HolderSource = {
    locks: () => reads[Math.min(count++, reads.length - 1)] ?? null,
    fileKey: (path) => (path === `${DATABASE}-shm` ? KEY : null),
    cmdline: (pid) => (pid === 200 ? ["squeal squeal daemon @9a7f9813", "daemon"] : null),
  };
  const pauses: number[] = [];
  const holders = refusedHoldersFrom(source, DATABASE, (ms) => pauses.push(ms));
  return { holders, reads: count, pauses };
}

describe("refusedHoldersFrom", () => {
  test("a first read that misses the holder is followed by one that names it", () => {
    const { holders, reads, pauses } = readsInTurn([[], [entry({})]]);

    expect(describeHolders(holders)).toBe(
      "held by pid 200 (squeal squeal daemon @9a7f9813 daemon)",
    );
    expect(reads).toBe(2);
    expect(pauses).toEqual([25]);
  });

  test("a read that names only a waiter is read again, and the holder comes first", () => {
    const waiter = entry({ pid: 300, blocked: true });
    const { holders, reads } = readsInTurn([[waiter], [waiter, entry({})]]);

    expect(holders?.map((h) => [h.pid, h.waiting])).toEqual([
      [200, false],
      [300, true],
    ]);
    expect(reads).toBe(2);
  });

  test("a first read that names the holder is the only read", () => {
    const { holders, reads, pauses } = readsInTurn([[entry({})]]);

    expect(holders?.map((h) => h.pid)).toEqual([200]);
    expect([reads, pauses]).toEqual([1, []]);
  });

  test("reads four times at most, with pauses under 100 ms, then says the holder is not known", () => {
    const { holders, reads, pauses } = readsInTurn([[]]);

    expect(describeHolders(holders)).toBe("the holder is not known");
    expect(reads).toBe(4);
    expect(pauses).toEqual([25, 25, 25]);
  });

  test("an unreadable /proc/locks is read once", () => {
    const { holders, reads, pauses } = readsInTurn([null, [entry({})]]);

    expect(holders).toBeUndefined();
    expect([reads, pauses]).toEqual([1, []]);
  });
});

describe("refusedLockHolders", () => {
  test.runIf(process.platform === "linux")(
    "names this process while it holds the write lock of a real store",
    () => {
      const path = join(tempDir("squeal-lock-refused-"), "store.sqlite");
      const db = new DatabaseSync(path);
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("CREATE TABLE t (x)");
      db.exec("BEGIN IMMEDIATE");
      db.exec("INSERT INTO t VALUES (1)");
      try {
        expect(refusedLockHolders(path)).toEqual([
          { pid: process.pid, command: expect.any(String), waiting: false },
        ]);
      } finally {
        db.exec("ROLLBACK");
        db.close();
      }
    },
  );

  test("a platform without /proc/locks gives undefined", () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
    try {
      expect(refusedLockHolders("/nowhere/store.sqlite")).toBeUndefined();
    } finally {
      if (platform !== undefined) Object.defineProperty(process, "platform", platform);
    }
  });
});
