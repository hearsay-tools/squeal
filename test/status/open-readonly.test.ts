import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { withStatusStore } from "../../src/core/status/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import { SCHEMA_VERSION } from "../../src/core/store/schema.js";
import { fakeRepo, seedStore } from "./helpers.js";

/*
 * Spec 024 D2 (row 024-02): `withStatusStore` opens a store at this Squeal's schema read-only.
 * A read never writes, never switches the journal or migrates, and its close runs no WAL
 * checkpoint, which the last read-write connection to close runs.
 */

/** A writer that leaves `key` committed in the WAL, not checkpointed, and is killed. */
async function killedWriter(database: string, key: string): Promise<void> {
  const script = `
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(process.argv[1]);
    db.exec("PRAGMA wal_autocheckpoint = 0");
    db.prepare("INSERT INTO meta (key, value) VALUES (?, 'v')").run(process.argv[2]);
    process.stdout.write("written\\n");
    setInterval(() => {}, 1000);
  `;
  const child = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", script, database, key],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  await new Promise<void>((resolve, reject) => {
    child.once("exit", (code) => reject(new Error(`writer exited ${code} before writing`)));
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("written")) resolve();
    });
  });
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
}

function seeded() {
  const repo = fakeRepo();
  seedStore(repo).close();
  return { root: repo.main, database: storePaths(repo.commonDir).database };
}

describe("status opens the store read-only (spec 024 D2)", () => {
  it("refuses a write in its read", () => {
    const { root } = seeded();
    const read = withStatusStore(root, {}, ({ store }) => {
      store.meta.set("probe", "written");
      return "wrote";
    });
    expect(read).toMatchObject({ available: false, reason: "store-unreadable" });
  });

  it("reads what a killed writer left in the WAL, and leaves the WAL and the file as they were", async () => {
    const { root, database } = seeded();
    await killedWriter(database, "left");
    const wal = `${database}-wal`;
    expect(statSync(wal).size).toBeGreaterThan(0);
    const before = { file: readFileSync(database), wal: readFileSync(wal) };

    expect(withStatusStore(root, {}, ({ store }) => store.meta.get("left"))).toBe("v");

    // A read-write connection, the last to close, would have copied the WAL into the file.
    expect(readFileSync(database).equals(before.file)).toBe(true);
    expect(existsSync(wal) && readFileSync(wal).equals(before.wal)).toBe(true);
  });

  it("leaves an older-schema store untouched and reports it unavailable without migrating (review 0.1.600 B2)", () => {
    const repo = fakeRepo();
    seedStore(repo).close();
    const { database } = storePaths(repo.commonDir);
    const writer = new DatabaseSync(database);
    writer.exec("PRAGMA journal_mode = WAL; PRAGMA user_version = 0;");
    writer.close();
    const wal = `${database}-wal`;
    const beforeFile = readFileSync(database);

    const read = withStatusStore(repo.main, {}, ({ store }) => store.meta.get("absent"));
    expect(read).toMatchObject({ available: false, reason: "store-unreadable" });
    expect("message" in (read as object) && (read as { message: string }).message).toContain(
      `older than supported ${SCHEMA_VERSION}`,
    );
    expect(readFileSync(database).equals(beforeFile)).toBe(true);
    expect(existsSync(wal) ? statSync(wal).size : 0).toBe(0);
    const check = new DatabaseSync(database, { readOnly: true });
    try {
      expect(check.prepare("PRAGMA user_version").get()?.user_version).toBe(0);
    } finally {
      check.close();
    }
  });

  it("reads an older-schema WAL store beside BEGIN IMMEDIATE without masking errors (review 0.1.600 B2)", () => {
    const repo = fakeRepo();
    seedStore(repo).close();
    const { database } = storePaths(repo.commonDir);
    const writer = new DatabaseSync(database);
    writer.exec("PRAGMA journal_mode = WAL; PRAGMA user_version = 0; BEGIN IMMEDIATE;");
    try {
      const read = withStatusStore(repo.main, { busyTimeoutMs: 20, busyRetryMs: 80 }, () => "read");
      expect(read).toMatchObject({ available: false, reason: "store-unreadable" });
      expect((read as { message: string }).message).not.toContain("database is not open");
      expect((read as { message: string }).message).toContain("older than supported");
    } finally {
      writer.exec("ROLLBACK");
      writer.close();
    }
  });

  it("retries for busyRetryMs on an older-schema store under an exclusive lock (review 0.1.600 B2)", () => {
    const repo = fakeRepo();
    seedStore(repo).close();
    const { database } = storePaths(repo.commonDir);
    const writer = new DatabaseSync(database);
    writer.exec(
      "PRAGMA journal_mode = DELETE; PRAGMA user_version = 0; PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE; CREATE TABLE lock_probe (x);",
    );
    try {
      const started = Date.now();
      const read = withStatusStore(repo.main, { busyTimeoutMs: 20, busyRetryMs: 80 }, () => "read");
      const elapsed = Date.now() - started;
      expect(read).toMatchObject({ available: false, reason: "timeout" });
      expect(elapsed).toBeGreaterThanOrEqual(70);
    } finally {
      writer.exec("ROLLBACK");
      writer.close();
    }
  });
});
