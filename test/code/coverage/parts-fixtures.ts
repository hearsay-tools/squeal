import { DatabaseSync } from "node:sqlite";
import {
  COVERAGE_PROVIDER_VERSION,
  type CoverageRecord,
  type CoverageSource,
  decodeRecord,
} from "../../../src/core/code/coverage/index.js";
import { shareRecord } from "../../../src/core/code/coverage/parts.js";
import { codeStorePath } from "../../../src/core/code/store/index.js";
import type { CodeStore } from "../../../src/core/code/store/types.js";

/* Records, parts and raw reads for the shared parts' tests (row 015-85). */

export const V = COVERAGE_PROVIDER_VERSION;
export const at = (resultKey: string, providerVersion = V) => ({ resultKey, providerVersion });

/** A bitset of 1-based lines, as `CoverageSource.lines` holds one. */
function bits(lines: readonly number[]): string {
  const bytes = new Uint8Array(4);
  for (const line of lines) {
    const i = (line - 1) >> 3;
    bytes[i] = (bytes[i] ?? 0) | (1 << ((line - 1) & 7));
  }
  return Buffer.from(bytes).toString("base64");
}

/** A source of four lines and one function over them, `ran` its hit. */
export function source(
  path: string,
  blob: string,
  covered: number[],
  ran: 0 | 1 = 1,
): CoverageSource {
  return {
    path,
    blob,
    lines: bits([1, 2, 3, 4]),
    covered: bits(covered),
    functions: [[1, 0, 4, 1, ran]],
  };
}

export function record(sources: CoverageSource[], unread: string[] = []): CoverageRecord {
  return { v: 1, sources, unread };
}

/** Stores `value` at `key` as its parts. */
export function share(store: CodeStore, key: string, value: CoverageRecord, time: number): void {
  store.coverage.putParts(at(key), shareRecord(value, V), time);
}

/** The record at `key`, decoded as the CRAP step decodes it. */
export function read(store: CodeStore, key: string, providerVersion = V): CoverageRecord | null {
  const bytes = store.coverage.get(at(key, providerVersion));
  return bytes === null ? null : decodeRecord(bytes);
}

/** Each `coverage_parts` row, by id, read through the test's own connection. */
export function partRows(dir: string): { id: number; hash: string; usedAt: number }[] {
  const db = new DatabaseSync(codeStorePath(dir), { readOnly: true });
  try {
    return db
      .prepare("SELECT id, hash, used_at FROM coverage_parts ORDER BY id")
      .all()
      .map((row) => ({ id: Number(row.id), hash: String(row.hash), usedAt: Number(row.used_at) }));
  } finally {
    db.close();
  }
}

/** The row's bytes at a key, as a daemon that predates row 015-85 reads them (0.1.362 `get`). */
export function rawRecord(dir: string, resultKey: string): Uint8Array {
  const db = new DatabaseSync(codeStorePath(dir), { readOnly: true });
  try {
    const row = db
      .prepare("SELECT record FROM coverage WHERE result_key = ? AND provider_version = ?")
      .get(resultKey, V);
    if (!(row?.record instanceof Uint8Array)) throw new Error(`no record at ${resultKey}`);
    return row.record;
  } finally {
    db.close();
  }
}

/** Runs one statement on the store's file through a connection of its own. */
export function sql(dir: string, text: string, ...params: (string | number | Uint8Array)[]): void {
  const db = new DatabaseSync(codeStorePath(dir));
  try {
    db.prepare(text).run(...params);
  } finally {
    db.close();
  }
}

export const A = source("src/a.ts", "blob-a", [1, 2]);
export const B = source("src/b.ts", "blob-b", [1]);
export const C = source("src/c.ts", "blob-c", [3]);
export const C2 = source("src/c.ts", "blob-c2", [3, 4]);
