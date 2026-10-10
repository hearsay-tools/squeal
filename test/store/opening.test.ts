import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { storePaths } from "../../src/core/store/index.js";
import { inspectConnection } from "../../src/core/store/open.js";
import { report, spawnOpener } from "./child/spawn.js";
import { fakeCommonDir, open, tempDir } from "./helpers.js";

const OPENERS = 8;
const STORES = 100;

interface OpenerReport {
  id: string;
  failures: { round: number; error: string }[];
}

describe("store opened by concurrent processes (task 001-207)", () => {
  // Switching a new file into WAL upgrades a read transaction to a write one, and SQLite fails
  // that upgrade at once, without the busy handler, while another opener holds the write lock.
  it(`${OPENERS} processes opening one store at once all open it, new or existing`, async () => {
    const baseDir = tempDir();
    for (let store = 0; store < STORES; store++)
      mkdirSync(join(baseDir, String(store), ".git"), { recursive: true });
    for (let round = 0; round < 2 * STORES; round++) mkdirSync(join(baseDir, `round-${round}`));

    const openers = Array.from({ length: OPENERS }, (_, i) =>
      spawnOpener([baseDir, String(i), String(OPENERS), String(2 * STORES)]),
    );
    const reports = await Promise.all(
      openers.map(async (opener) => report<OpenerReport>(await opener.done)),
    );

    expect(reports.flatMap((r) => r.failures)).toEqual([]);
  }, 120_000);

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
    await new Promise((resolve) => holder.stdout.once("data", resolve));

    expect(inspectConnection(open(commonDir)).journalMode).toBe("wal");
    expect(await released).toBe(0);
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
