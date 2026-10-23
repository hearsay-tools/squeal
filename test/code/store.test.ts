import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CODE_SCHEMA_VERSION,
  codeStorePath,
  isCodeStoreOpenFailure,
  openCodeStore,
} from "../../src/core/code/store/index.js";
import { isStoreOpenFailure, openStore, storePaths } from "../../src/core/store/index.js";
import { SCHEMA_VERSION } from "../../src/core/store/schema.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { commonDir, count, ON, open } from "./helpers.js";

const register = fileURLToPath(new URL("../store/child/register-ts.mjs", import.meta.url));
const child = fileURLToPath(new URL("./child/holder.ts", import.meta.url));

const TABLES = ["checks", "counts", "coverage", "files", "meta", "states", "transitions", "views"];

function tables(path: string): string[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => String(row.name));
  } finally {
    db.close();
  }
}

function pragma(path: string, name: string): unknown {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return Object.values(db.prepare(`PRAGMA ${name}`).get() ?? {})[0];
  } finally {
    db.close();
  }
}

describe("code store open (015 D4)", () => {
  it("with the policy off, opens nothing and creates no code.sqlite beside the store", () => {
    const dir = commonDir();
    const store = openStore(dir);
    if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
    store.close();
    expect(openCodeStore(dir, DEFAULT_POLICY)).toEqual({ reason: "off" });
    expect(openCodeStore(dir, DEFAULT_POLICY, { create: false })).toEqual({ reason: "off" });
    expect(readdirSync(storePaths(dir).dir).filter((name) => name.startsWith("code"))).toEqual([]);
    expect(pragma(storePaths(dir).database, "user_version")).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("with the policy on, creates code.sqlite beside the store, migrated, in WAL", () => {
    const dir = commonDir();
    const store = open(dir);
    expect(store.path).toBe(codeStorePath(dir));
    expect(codeStorePath(dir)).toBe(`${storePaths(dir).dir}/code.sqlite`);
    expect(store.schemaVersion).toBe(CODE_SCHEMA_VERSION);
    expect(tables(store.path)).toEqual(TABLES);
    expect(pragma(store.path, "journal_mode")).toBe("wal");
    expect(pragma(store.path, "auto_vacuum")).toBe(2);
    // The main store is neither created nor touched.
    expect(existsSync(storePaths(dir).database)).toBe(false);
  });

  it("gives a reader that must not create it `missing`, and creates nothing", () => {
    const dir = commonDir();
    expect(openCodeStore(dir, ON, { create: false })).toEqual({ reason: "missing" });
    expect(existsSync(codeStorePath(dir))).toBe(false);
  });

  it("is read without a write: it opens and reads while another connection holds the write lock", () => {
    const dir = commonDir();
    const writer = open(dir);
    writer.counts.put(count("b1"), 1_000);
    writer.close();
    const before = readFileSync(codeStorePath(dir));
    const holder = new DatabaseSync(codeStorePath(dir));
    holder.exec("BEGIN IMMEDIATE");
    try {
      const reader = open(dir, { create: false, busyTimeoutMs: 0 });
      expect(reader.read(() => reader.counts.get("b1", "typescript", 1))).toEqual(count("b1"));
      expect(reader.read(() => reader.states.list("w1"))).toEqual([]);
      reader.close();
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }
    expect(readFileSync(codeStorePath(dir)).equals(before)).toBe(true);
  });

  it("refuses a newer user_version and leaves the file untouched", () => {
    const dir = commonDir();
    open(dir).close();
    const db = new DatabaseSync(codeStorePath(dir));
    db.exec(`PRAGMA user_version = ${CODE_SCHEMA_VERSION + 1}`);
    db.close();
    const mtime = statSync(codeStorePath(dir)).mtimeMs;
    expect(openCodeStore(dir, ON)).toEqual({
      reason: "newer-schema",
      found: CODE_SCHEMA_VERSION + 1,
      supported: CODE_SCHEMA_VERSION,
    });
    expect(statSync(codeStorePath(dir)).mtimeMs).toBe(mtime);
  });

  it("reports a file that is not a database as corrupt and leaves it in place", () => {
    const dir = commonDir();
    open(dir).close();
    writeFileSync(
      codeStorePath(dir),
      "not a database, but long enough to have a header. ".repeat(4),
    );
    const opened = openCodeStore(dir, ON);
    expect(isCodeStoreOpenFailure(opened) && opened.reason).toBe("corrupt");
    expect(existsSync(codeStorePath(dir))).toBe(true);
  });

  // Concurrent openers, made deterministic (task 001-207): without `switchToWal`'s retry the
  // first case fails at once on "database is locked"; without the version re-read under the
  // migration's lock the second runs V1 again and fails on a table that exists.
  it.each([
    ["switches into WAL", "rollback"],
    ["migrates once", "migrate"],
  ])(
    "%s while another process holds the write lock",
    async (_, mode) => {
      const dir = commonDir();
      mkdirSync(storePaths(dir).dir, { recursive: true });
      const holder = spawn(
        process.execPath,
        [
          "--disable-warning=ExperimentalWarning",
          "--import",
          register,
          child,
          codeStorePath(dir),
          mode,
        ],
        { stdio: ["ignore", "pipe", "inherit"] },
      );
      const released = new Promise((resolve) => holder.on("close", resolve));
      try {
        await new Promise((resolve) => holder.stdout.once("data", resolve));
        const store = open(dir);
        expect(store.schemaVersion).toBe(CODE_SCHEMA_VERSION);
        expect(await released).toBe(0);
      } finally {
        holder.kill("SIGKILL");
        await released;
      }
      expect(pragma(codeStorePath(dir), "journal_mode")).toBe("wal");
      expect(pragma(codeStorePath(dir), "user_version")).toBe(CODE_SCHEMA_VERSION);
      expect(tables(codeStorePath(dir))).toEqual(
        mode === "rollback" ? [...TABLES, "holder"].sort() : TABLES,
      );
    },
    30_000,
  );
});
