import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CODE_SCHEMA_VERSION, codeStorePath } from "../../src/core/code/store/index.js";
import { commonDir, open } from "./helpers.js";

/*
 * Row 015-44: the coverage records' index, which gives each record's stored
 * time without its blob. It arrives at open when absent, with no
 * `user_version` raise, so an older daemon keeps the store; a reader works
 * without it.
 */

const register = fileURLToPath(new URL("../store/child/register-ts.mjs", import.meta.url));
const child = fileURLToPath(new URL("./child/holder.ts", import.meta.url));
const INDEX = "coverage_stored";
const at = (resultKey: string) => ({ resultKey, providerVersion: 2 });

function indexed(path: string): boolean {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(INDEX) !== undefined;
  } finally {
    db.close();
  }
}

/** A store as a daemon that predates the index leaves it: version 1, records, no index. */
function older(dir: string): void {
  const store = open(dir);
  store.coverage.put(at("k1"), Uint8Array.from([1, 2, 3]), 1_000);
  store.coverage.put(at("k2"), Uint8Array.from([4]), 2_000);
  store.close();
  const db = new DatabaseSync(codeStorePath(dir));
  db.exec(`DROP INDEX IF EXISTS ${INDEX}`);
  db.close();
}

function answers(store: ReturnType<typeof open>) {
  return ["k1", "k2", "k3"].map((key) => [
    store.coverage.storedAt(at(key)),
    store.coverage.has(at(key)),
    store.coverage.get(at(key)),
  ]);
}

describe("the coverage records' index (row 015-44)", () => {
  it("is made at the first open of a store without it, and user_version stays 1", () => {
    const dir = commonDir();
    older(dir);
    expect(indexed(codeStorePath(dir))).toBe(false);
    const store = open(dir);
    expect(indexed(codeStorePath(dir))).toBe(true);
    expect(store.schemaVersion).toBe(1);
    expect(CODE_SCHEMA_VERSION).toBe(1);
    expect(answers(store)[0]).toEqual([1_000, true, Uint8Array.from([1, 2, 3])]);
  });

  it("takes no write lock at a second open", () => {
    const dir = commonDir();
    open(dir).close();
    const before = readFileSync(codeStorePath(dir));
    const holder = new DatabaseSync(codeStorePath(dir));
    holder.exec("BEGIN IMMEDIATE");
    try {
      const store = open(dir, { busyTimeoutMs: 0 });
      expect(store.read(() => store.coverage.has(at("k1")))).toBe(false);
      store.close();
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }
    expect(readFileSync(codeStorePath(dir)).equals(before)).toBe(true);
  });

  it("is not made by a reader, which gives the same answers without it", () => {
    const dir = commonDir();
    older(dir);
    const reader = open(dir, { create: false });
    const without = answers(reader);
    reader.close();
    expect(indexed(codeStorePath(dir))).toBe(false);
    expect(without).toEqual([
      [1_000, true, Uint8Array.from([1, 2, 3])],
      [2_000, true, Uint8Array.from([4])],
      [null, false, null],
    ]);
    expect(answers(open(dir))).toEqual(without);
  });

  it("gives each record stored at a key its own stored time, within one ms too", () => {
    const store = open(commonDir());
    store.coverage.put(at("k1"), Uint8Array.from([1]), 1_000);
    store.coverage.put(at("k2"), Uint8Array.from([1]), 1_000);
    expect(store.coverage.storedAt(at("k1"))).toBe(1_000);
    store.coverage.put(at("k1"), Uint8Array.from([2]), 1_000);
    expect(store.coverage.storedAt(at("k1"))).toBe(1_001);
    store.coverage.put(at("k1"), Uint8Array.from([3]), 500);
    expect(store.coverage.storedAt(at("k1"))).toBe(1_002);
    store.coverage.put(at("k1"), Uint8Array.from([4]), 5_000);
    expect(store.coverage.storedAt(at("k1"))).toBe(5_000);
    expect(store.coverage.storedAt(at("k2"))).toBe(1_000);
  });

  // Without the second look under the lock, the open runs CREATE INDEX on one that exists.
  it("is made once while another process makes it", async () => {
    const dir = commonDir();
    older(dir);
    const holder = spawn(
      process.execPath,
      [
        "--disable-warning=ExperimentalWarning",
        "--import",
        register,
        child,
        codeStorePath(dir),
        "index",
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    const released = new Promise((resolve) => holder.on("close", resolve));
    try {
      await new Promise((resolve) => holder.stdout.once("data", resolve));
      const store = open(dir);
      expect(store.coverage.storedAt(at("k1"))).toBe(1_000);
      expect(await released).toBe(0);
    } finally {
      holder.kill("SIGKILL");
      await released;
    }
    expect(indexed(codeStorePath(dir))).toBe(true);
  }, 30_000);
});
