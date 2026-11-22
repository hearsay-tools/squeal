import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

  it("opens a store at an older schema read-write, which migrates it, as before", () => {
    const repo = fakeRepo();
    seedStore(repo).close();
    const { database } = storePaths(repo.commonDir);
    writeFileSync(database, "");
    expect(withStatusStore(repo.main, {}, ({ store }) => store.meta.get("absent"))).toBeNull();
    const db = new DatabaseSync(database);
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(SCHEMA_VERSION);
    db.close();
  });
});
