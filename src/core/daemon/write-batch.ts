import type { SQLInputValue } from "node:sqlite";
import { connectionOf } from "../store/store.js";
import type { SentBatch, SentParam } from "../types/daemon-writes.js";
import type { Store } from "../types/store.js";

/*
 * Spec 021 D15 (row 021-16): the statements a client sends for the daemon
 * to write, encoded for one JSON line, and the rule for which ones it runs:
 * data statements on the store's own tables only (the coordinator,
 * 2026-11-11). `node:sqlite` at the 22.19 floor has no authorizer, and its
 * `prepare` compiles the first statement and drops the rest, so the rule
 * reads the text.
 */

/** One write statement and its parameters, as a `Connection` ran it. */
export interface Statement {
  readonly sql: string;
  readonly params: readonly SQLInputValue[];
}

/** `statements` as one batch: each distinct text once, each row naming its text by index. */
export function encodeBatch(statements: readonly Statement[]): SentBatch {
  const sqls: string[] = [];
  const index = new Map<string, number>();
  const rows = statements.map(({ sql, params }): [number, ...SentParam[]] => {
    let at = index.get(sql);
    if (at === undefined) {
      at = sqls.push(sql) - 1;
      index.set(sql, at);
    }
    return [at, ...params.map(encodeParam)];
  });
  return { sqls, rows };
}

/** The statements of `batch`, in order. Assumes `parseBatch` accepted it. */
export function decodeBatch(batch: SentBatch): Statement[] {
  return batch.rows.map(([at, ...params]) => ({
    sql: batch.sqls[at] as string,
    params: params.map(decodeParam),
  }));
}

/**
 * How long the daemon tries a sent batch on a busy store before it fails
 * it: a client waits at most D1's 10 s bound for its answer, and a batch
 * no one waits for must not queue behind the lock for long.
 */
export const SENT_WRITE_BOUND_MS = 30_000;

/**
 * Writes `statements` over `store` in one transaction, in order: the
 * daemon's write of a sent batch, and a client's own when no daemon takes
 * it. A statement that fails rolls the whole batch back.
 */
export function writeBatch(store: Store, statements: readonly Statement[]): void {
  const connection = connectionOf(store);
  store.transaction(() => {
    for (const { sql, params } of statements) connection.run(sql, ...params);
  });
}

/** `value` as a batch whose every statement may be written; a string says why not. */
export function parseBatch(value: unknown): SentBatch | string {
  if (typeof value !== "object" || value === null) return '"batch" must be an object';
  const { sqls, rows } = value as Record<string, unknown>;
  if (!Array.isArray(sqls) || !sqls.every((s) => typeof s === "string")) {
    return '"batch.sqls" must be a list of strings';
  }
  for (const sql of sqls) {
    const refused = refusedStatement(sql);
    if (refused !== null) return refused;
  }
  if (!Array.isArray(rows)) return '"batch.rows" must be a list';
  for (const row of rows) {
    if (!Array.isArray(row) || !isIndex(row[0], sqls.length) || !row.slice(1).every(isParam)) {
      return '"batch.rows" must hold [statement index, ...parameters]';
    }
  }
  return { sqls, rows } as SentBatch;
}

function isIndex(value: unknown, length: number): boolean {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < length;
}

function isParam(value: unknown): value is SentParam {
  if (value === null || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  const keys = Object.keys(value);
  const record = value as Record<string, unknown>;
  if (keys.length !== 1) return false;
  if (keys[0] === "bigint")
    return typeof record.bigint === "string" && /^-?\d+$/.test(record.bigint);
  return keys[0] === "bytes" && typeof record.bytes === "string";
}

function encodeParam(value: SQLInputValue): SentParam {
  if (value === null || typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "bigint") return { bigint: value.toString() };
  const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return { bytes: bytes.toString("base64") };
}

function decodeParam(value: SentParam): SQLInputValue {
  if (value === null || typeof value === "number" || typeof value === "string") return value;
  if ("bigint" in value) return BigInt(value.bigint);
  return new Uint8Array(Buffer.from(value.bytes, "base64"));
}

const WRITES = new Set(["INSERT", "REPLACE", "UPDATE", "DELETE"]);
const CONFLICTS = new Set(["ROLLBACK", "ABORT", "REPLACE", "FAIL", "IGNORE"]);

/**
 * Why the daemon will not run `sql`, or `null` when it will: one `INSERT`,
 * `REPLACE`, `UPDATE` or `DELETE` statement on a table of the store's own
 * schema, named without a schema and not one of SQLite's `sqlite_` tables.
 * So no `ATTACH`, `PRAGMA`, schema change, transaction control or
 * statement after the first.
 */
export function refusedStatement(sql: string): string | null {
  const tokens = tokenize(sql);
  if (tokens === null) return "a statement has an unterminated quote or comment";
  const first = tokens[0];
  if (first?.kind !== "word" || !WRITES.has(first.upper)) {
    return `only INSERT, REPLACE, UPDATE and DELETE are written, not ${JSON.stringify(sql.trim().slice(0, 40))}`;
  }
  const end = tokens.findIndex((t) => t.kind === "end");
  if (end >= 0 && tokens.slice(end + 1).some((t) => t.kind !== "end")) {
    return "one statement per entry: a statement follows the first";
  }
  const table = targetOf(tokens);
  if (table === null) return `no table named in ${JSON.stringify(sql.trim().slice(0, 40))}`;
  if (table.qualified) return `a table named with its schema is not written: ${table.name}`;
  if (table.name.toLowerCase().startsWith("sqlite_")) {
    return `SQLite's own table ${table.name} is not written`;
  }
  return null;
}

interface Token {
  readonly kind: "word" | "name" | "dot" | "end" | "other";
  readonly upper: string;
  readonly text: string;
}

/** The table a write statement names, after its keyword and conflict clause. */
function targetOf(tokens: readonly Token[]): { name: string; qualified: boolean } | null {
  const upper = (i: number) => (tokens[i]?.kind === "word" ? (tokens[i]?.upper ?? "") : "");
  const verb = upper(0);
  let at = 1;
  if ((verb === "INSERT" || verb === "UPDATE") && upper(at) === "OR" && CONFLICTS.has(upper(2))) {
    at += 2;
  }
  if (verb === "INSERT" || verb === "REPLACE") {
    if (upper(at) !== "INTO") return null;
    at++;
  }
  if (verb === "DELETE") {
    if (upper(at) !== "FROM") return null;
    at++;
  }
  const name = tokens[at];
  if (name === undefined || (name.kind !== "word" && name.kind !== "name")) return null;
  return { name: name.text, qualified: tokens[at + 1]?.kind === "dot" };
}

/** `sql` as tokens without whitespace and comments; `null` when a quote or comment never ends. */
function tokenize(sql: string): Token[] | null {
  const tokens: Token[] = [];
  const push = (kind: Token["kind"], text: string) =>
    tokens.push({ kind, text, upper: text.toUpperCase() });
  let i = 0;
  while (i < sql.length) {
    const c = sql[i] as string;
    if (/\s/.test(c)) i++;
    else if (sql.startsWith("--", i)) {
      const nl = sql.indexOf("\n", i);
      i = nl < 0 ? sql.length : nl + 1;
    } else if (sql.startsWith("/*", i)) {
      const close = sql.indexOf("*/", i + 2);
      if (close < 0) return null;
      i = close + 2;
    } else if (c === "'" || c === '"' || c === "`" || c === "[") {
      const end = quoteEnd(sql, i);
      if (end < 0) return null;
      push(c === "'" ? "other" : "name", sql.slice(i + 1, end - 1));
      i = end;
    } else if (/[A-Za-z_]/.test(c)) {
      const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(i))?.[0] ?? c;
      push("word", word);
      i += word.length;
    } else {
      push(c === ";" ? "end" : c === "." ? "dot" : "other", c);
      i++;
    }
  }
  return tokens;
}

/** The index after the quote that opens at `start` ends; -1 when it never does. A doubled quote is one. */
function quoteEnd(sql: string, start: number): number {
  const closer = sql[start] === "[" ? "]" : (sql[start] as string);
  let from = start + 1;
  for (;;) {
    const k = sql.indexOf(closer, from);
    if (k < 0) return -1;
    if (closer === "]" || sql[k + 1] !== closer) return k + 1;
    from = k + 2;
  }
}
