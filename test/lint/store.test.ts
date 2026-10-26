import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { codeStorePath } from "../../src/core/code/store/index.js";
import { loadPolicy } from "../../src/core/daemon/policy.js";
import {
  isLintStoreOpenFailure,
  LINT_SCHEMA_VERSION,
  lintStorePath,
  openLintStore,
} from "../../src/core/lint/store/index.js";
import { storePaths } from "../../src/core/store/index.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { commonDir, LINT_ON, open } from "./helpers.js";

/* Spec 017 D6: `lint.sqlite`, its own file, opened only while `lint.enabled` holds (goal 1). */

const TABLES = ["checks", "meta", "results", "states", "transitions", "views"];

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

describe("lint store open (017 D6)", () => {
  it("with no lint section, is off and creates nothing on disk, whatever complexity says", () => {
    const dir = commonDir();
    const { policy } = loadPolicy(dir);
    expect(policy.lint.enabled).toBe(false);
    expect(policy.complexity.enabled).toBe(true);
    expect(openLintStore(dir, policy)).toEqual({ reason: "off" });
    expect(openLintStore(dir, DEFAULT_POLICY, { create: false })).toEqual({ reason: "off" });
    expect(existsSync(lintStorePath(dir))).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("with lint on, creates lint.sqlite beside the store, migrated, in WAL, and no other store", () => {
    const dir = commonDir();
    const store = open(dir);
    expect(store.path).toBe(lintStorePath(dir));
    expect(lintStorePath(dir)).toBe(`${storePaths(dir).dir}/lint.sqlite`);
    expect(store.schemaVersion).toBe(LINT_SCHEMA_VERSION);
    expect(LINT_SCHEMA_VERSION).toBe(1);
    expect(tables(store.path)).toEqual(TABLES);
    expect(pragma(store.path, "journal_mode")).toBe("wal");
    expect(pragma(store.path, "auto_vacuum")).toBe(2);
    // Neither the main store nor code.sqlite is created or touched.
    expect(existsSync(storePaths(dir).database)).toBe(false);
    expect(existsSync(codeStorePath(dir))).toBe(false);
  });

  it("gives a reader that must not create it `missing`, and creates nothing", () => {
    const dir = commonDir();
    expect(openLintStore(dir, LINT_ON, { create: false })).toEqual({ reason: "missing" });
    expect(existsSync(lintStorePath(dir))).toBe(false);
  });

  it("opens an existing file for a reader, at the same version", () => {
    const dir = commonDir();
    open(dir).close();
    expect(open(dir, { create: false }).schemaVersion).toBe(LINT_SCHEMA_VERSION);
  });

  it("refuses a newer user_version and leaves the file untouched", () => {
    const dir = commonDir();
    open(dir).close();
    const db = new DatabaseSync(lintStorePath(dir));
    db.exec(`PRAGMA user_version = ${LINT_SCHEMA_VERSION + 1}`);
    db.close();
    const mtime = statSync(lintStorePath(dir)).mtimeMs;
    expect(openLintStore(dir, LINT_ON)).toEqual({
      reason: "newer-schema",
      found: LINT_SCHEMA_VERSION + 1,
      supported: LINT_SCHEMA_VERSION,
    });
    expect(statSync(lintStorePath(dir)).mtimeMs).toBe(mtime);
  });

  it("reports a file that is not a database as corrupt and leaves it in place", () => {
    const dir = commonDir();
    open(dir).close();
    writeFileSync(
      lintStorePath(dir),
      "not a database, but long enough to have a header. ".repeat(4),
    );
    const opened = openLintStore(dir, LINT_ON);
    expect(isLintStoreOpenFailure(opened) && opened.reason).toBe("corrupt");
    expect(existsSync(lintStorePath(dir))).toBe(true);
  });
});
