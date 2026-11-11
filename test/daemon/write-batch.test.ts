import { describe, expect, it } from "vitest";
import { parseRequest } from "../../src/core/daemon/protocol.js";
import {
  decodeBatch,
  encodeBatch,
  parseBatch,
  refusedStatement,
} from "../../src/core/daemon/write-batch.js";

/*
 * Spec 021 D15 (row 021-16): a hook's or command's writes travel to the
 * daemon as statements, and the daemon runs only data statements on the
 * store's own tables (the coordinator, 2026-11-11): each refusal below is
 * one the guard must make, and the statements hooks send today pass.
 */

/** The write statements hooks sent in the 021-16 probe (test/delivery and test/harness). */
const HOOK_WRITES = [
  "INSERT OR REPLACE INTO consumer_views (worktree_id, session_id, agent_id, check_id, outcome, fingerprint, told_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  "INSERT INTO checks (project, test_path, kind, full_name, templated, first_seen_at) VALUES (?, ?, ?, ?, 0, ?) ON CONFLICT DO NOTHING",
  "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
  "UPDATE consumers SET last_seen_at = ?, last_delivered_at = CASE WHEN ? THEN ? ELSE last_delivered_at END WHERE worktree_id = ? AND session_id = ? AND agent_id = ?",
  "DELETE FROM consumers WHERE worktree_id = ? AND session_id = ? AND agent_id = ?",
  "INSERT INTO consumers (worktree_id, session_id, agent_id, registered_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
  "DELETE FROM meta WHERE key = ?",
  "UPDATE results SET last_used_at = ? WHERE key = ? AND last_used_at < ?",
  "REPLACE INTO meta (key, value) VALUES (?, ?)",
];

describe("the statements the daemon writes (021-16)", () => {
  it.each(HOOK_WRITES)("runs a hook's data statement: %s", (sql) => {
    expect(refusedStatement(sql)).toBeNull();
  });

  it.each([
    ["ATTACH", "ATTACH DATABASE '/tmp/x.sqlite' AS x"],
    ["PRAGMA", "PRAGMA journal_mode = DELETE"],
    ["CREATE", "CREATE TABLE evil (a)"],
    ["DROP", "DROP TABLE meta"],
    ["ALTER", "ALTER TABLE meta ADD COLUMN x"],
    ["BEGIN", "BEGIN IMMEDIATE"],
    ["COMMIT", "COMMIT"],
    ["VACUUM", "VACUUM INTO '/tmp/copy.sqlite'"],
    ["SELECT", "SELECT value FROM meta"],
    ["a CTE before the write", "WITH x AS (SELECT 1) DELETE FROM meta"],
    ["a comment before a refused statement", "/* INSERT */ DROP TABLE meta"],
  ])("refuses %s", (_, sql) => {
    expect(refusedStatement(sql)).toMatch(/^only INSERT, REPLACE, UPDATE and DELETE are written/);
  });

  it("refuses a second statement after the first", () => {
    expect(refusedStatement("DELETE FROM meta WHERE key = ?; DROP TABLE meta")).toMatch(
      /^one statement per entry/,
    );
    expect(refusedStatement("DELETE FROM meta WHERE key = 'a;b'")).toBeNull();
    expect(refusedStatement("DELETE FROM meta WHERE key = ?;  -- end")).toBeNull();
  });

  it.each([
    "INSERT INTO main.meta (key, value) VALUES (?, ?)",
    "INSERT INTO temp.meta (key, value) VALUES (?, ?)",
    'UPDATE "x"."meta" SET value = ?',
    "DELETE FROM x . meta",
  ])("refuses a table named with its schema: %s", (sql) => {
    expect(refusedStatement(sql)).toMatch(/^a table named with its schema/);
  });

  it.each([
    "INSERT INTO sqlite_master (type, name) VALUES (?, ?)",
    "DELETE FROM sqlite_sequence",
    "UPDATE OR REPLACE SQLITE_STAT1 SET stat = ?",
  ])("refuses SQLite's own tables: %s", (sql) => {
    expect(refusedStatement(sql)).toMatch(/^SQLite's own table/);
  });

  it("refuses an unterminated quote or comment, and a write that names no table", () => {
    expect(refusedStatement("DELETE FROM meta WHERE key = 'x")).toMatch(/unterminated/);
    expect(refusedStatement("DELETE FROM meta /* x")).toMatch(/unterminated/);
    expect(refusedStatement("INSERT INTO (a) VALUES (1)")).toMatch(/^no table named/);
    expect(refusedStatement("DELETE meta")).toMatch(/^no table named/);
  });

  it("refuses a whole request that carries one refused statement", () => {
    const batch = { sqls: [HOOK_WRITES[2], "PRAGMA writable_schema = 1"], rows: [[0, "k", "v"]] };
    const line = JSON.stringify({
      type: "write",
      worktreeId: "w",
      storeSchema: 1,
      token: null,
      release: false,
      batch,
    });
    expect(parseRequest(line)).toMatch(/^only INSERT, REPLACE, UPDATE and DELETE/);
  });

  it("refuses rows that name no statement or carry other values", () => {
    const sqls = [HOOK_WRITES[6] as string];
    expect(parseBatch({ sqls, rows: [[1, "k"]] })).toMatch(/statement index/);
    expect(parseBatch({ sqls, rows: [[0, { object: 1 }]] })).toMatch(/statement index/);
    expect(parseBatch({ sqls, rows: [[0, Number.NaN]] })).toMatch(/statement index/);
    expect(parseBatch({ sqls, rows: [[0, "k"]] })).toEqual({ sqls, rows: [[0, "k"]] });
  });

  it("keeps each text once and every parameter type through JSON", () => {
    const sql = HOOK_WRITES[2] as string;
    const bytes = new Uint8Array([0, 1, 255]);
    const statements = [
      { sql, params: ["a", 1.5] },
      { sql, params: [null, 9007199254740993n] },
      { sql, params: [bytes, -2] },
    ];
    const batch = encodeBatch(statements);
    expect(batch.sqls).toEqual([sql]);
    const back = decodeBatch(JSON.parse(JSON.stringify(batch)));
    expect(back).toEqual(statements);
  });
});
