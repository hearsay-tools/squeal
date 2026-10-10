import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { storePaths } from "../../src/core/store/index.js";
import { inspectConnection } from "../../src/core/store/open.js";
import { report, spawnOpener } from "./child/spawn.js";
import { fakeCommonDir, open, tempDir } from "./helpers.js";

const OPENERS = 8;
/** Two stores, created in the first two rounds and reopened in the last two. */
const ROUNDS = 4;
/** How long a party waits at a round's rendezvous, here and in each opener. */
const RENDEZVOUS_MS = 20_000;

interface OpenerReport {
  failures: { round: number; error: string }[];
}

/** Resolves with `promise`, or rejects past `ms`. */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} not within ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

describe("store opened by concurrent processes (task 001-207)", () => {
  // A smoke test: the deterministic case below is what fails without the retry (review wave-13r S1).
  it(`${OPENERS} processes opening one store at once all open it, new or existing`, async () => {
    const baseDir = tempDir();
    for (let store = 0; store < ROUNDS / 2; store++)
      mkdirSync(join(baseDir, String(store), ".git"), { recursive: true });
    const openers = Array.from({ length: OPENERS }, () =>
      spawnOpener([baseDir, String(ROUNDS), String(RENDEZVOUS_MS)]),
    );
    try {
      // Every opener blocks on stdin until all are ready, then the round's opens start at once.
      for (let round = 0; round < ROUNDS; round++) {
        await within(
          Promise.all(openers.map((opener) => opener.waitFor(`ready ${round}\n`))),
          RENDEZVOUS_MS,
          `round ${round}'s rendezvous`,
        );
        for (const opener of openers) opener.child.stdin?.write("go\n");
      }
      const reports = await within(
        Promise.all(openers.map(async (opener) => report<OpenerReport>(await opener.done))),
        RENDEZVOUS_MS,
        "the openers' reports",
      );
      expect(reports.flatMap((r) => r.failures)).toEqual([]);
    } finally {
      for (const opener of openers) opener.child.kill("SIGKILL");
      await Promise.allSettled(openers.map((opener) => opener.done));
    }
  }, 60_000);

  it("waits out a write lock another process holds when it switches the file into WAL", async () => {
    // A file still in rollback mode, with a table, so opening it skips `auto_vacuum` and goes
    // straight to the switch while another process holds the write lock for 500 ms.
    const commonDir = fakeCommonDir();
    const paths = storePaths(commonDir);
    mkdirSync(paths.dir, { recursive: true });
    const holder = spawn(process.execPath, ["-e", HOLD_WRITE_LOCK, paths.database], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    const released = new Promise((resolve) => holder.on("close", resolve));
    try {
      await new Promise((resolve) => holder.stdout.once("data", resolve));
      expect(inspectConnection(open(commonDir)).journalMode).toBe("wal");
      expect(await released).toBe(0);
    } finally {
      holder.kill("SIGKILL");
      await released;
    }
  }, 30_000);
});

const HOLD_WRITE_LOCK = `
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1]);
db.exec("CREATE TABLE holder (x)");
db.exec("BEGIN IMMEDIATE");
db.exec("INSERT INTO holder VALUES (1)");
console.log("held");
setTimeout(() => db.exec("COMMIT"), 500);
`;
