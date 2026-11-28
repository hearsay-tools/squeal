/*
 * Throwaway probe, row 011-440 (wave 132). What the gate's `readStores` (src/core/code/gate/stored.ts)
 * gives while `code.sqlite` is being created, as `openCodeStore` creates it: the file exists before its
 * schema version is set (step 1), and in rollback-journal mode before the WAL switch a creating
 * transaction locks readers out (step 2). `readStores` returning null makes `openStored` null: the gate
 * runs every file and keeps none, and tells no reason (`notKeptWhy`: "gave no reason").
 * Writes output.txt; asserts only the setup.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, it } from "vitest";
import { readStores } from "../../../../../../../src/core/code/gate/stored.js";
import { codeStorePath, openCodeStore } from "../../../../../../../src/core/code/store/open.js";
import { openStore } from "../../../../../../../src/core/store/open.js";
import { DEFAULT_POLICY } from "../../../../../../../src/core/types/policy.js";
import type { AbsolutePath } from "../../../../../../../src/core/types/common.js";

const rows: string[] = [];
afterAll(() => writeFileSync(join(import.meta.dirname, "output.txt"), `${rows.join("\n")}\n`));

function commonDir(): AbsolutePath {
  const dir = mkdtempSync(join(tmpdir(), "sq-store-window-")) as AbsolutePath;
  mkdirSync(join(dir, "squeal"), { recursive: true });
  const main = openStore(dir, { create: true });
  if ("reason" in main) throw new Error(main.reason);
  main.close();
  return dir;
}

function read(label: string, dir: AbsolutePath) {
  const started = performance.now();
  const stores = readStores(dir);
  const ms = Math.round(performance.now() - started);
  rows.push(`${label} | readStores ${stores === null ? "null (gate keeps nothing)" : `stores, code ${stores.code === undefined ? "missing" : "open"}`} | ${ms} ms`);
  stores?.close();
}

it("readStores across code.sqlite's creation", async () => {
  const dir = commonDir();
  read("0. no code.sqlite yet", dir);

  // 1. The file a `new DatabaseSync(path)` makes, before `migrate` sets its version.
  const early = new DatabaseSync(codeStorePath(dir));
  early.exec("PRAGMA auto_vacuum = INCREMENTAL");
  rows.push(`   code.sqlite user_version: ${Object.values(early.prepare("PRAGMA user_version").get() ?? {})[0]}`);
  read("1. code.sqlite created, schema version not yet set", dir);
  early.close();

  // 2. Another process inside a creating transaction, journal mode still the default (delete).
  const holder = spawn(process.execPath, ["-e", `
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(${JSON.stringify(codeStorePath(dir))});
    db.exec("BEGIN EXCLUSIVE"); db.exec("CREATE TABLE t (x)");
    process.stdout.write("held\\n");
    setTimeout(() => { db.exec("ROLLBACK"); db.close(); }, 3000);
  `], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((done) => holder.stdout.once("data", done));
  read("2. another process holds a creating transaction (3 s)", dir);
  await new Promise((done) => holder.once("exit", done));

  // 3. The store as `openCodeStore` leaves it.
  const code = openCodeStore(dir, DEFAULT_POLICY);
  if ("reason" in code) throw new Error(code.reason);
  code.close();
  read("3. code.sqlite created and migrated", dir);
}, 30_000);
