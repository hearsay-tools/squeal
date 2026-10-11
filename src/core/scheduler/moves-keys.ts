import { createHash } from "node:crypto";
import { isRecord } from "../fs/index.js";
import { testFileId } from "../keys/index.js";
import type { RevisionNumber, TestFileKeyRecord } from "../types/index.js";

/*
 * Review wave 13ac, B1 (task 001-265): what the store's re-key moves
 * (`recordMoves`) know of the `test_file_keys` rows their writer
 * wrote, so a row another writer wrote is told apart. Per test file, by
 * `testFileId`: the row's revision and a digest of its key, `null` for an
 * unkeyed file. The revision catches a key moved away and back.
 */

/** A row's revision and its key's digest. */
export type KeyMark = [RevisionNumber, string | null];

export type KeyMarks = Record<string, KeyMark>;

function keyMark(row: TestFileKeyRecord): KeyMark {
  const key = row.key === null ? null : createHash("sha256").update(row.key).digest("base64url");
  return [row.revision, key === null ? null : key.slice(0, 16)];
}

const same = (a: KeyMark | undefined, b: KeyMark) => a?.[0] === b[0] && a[1] === b[1];

/** The marks a stored row holds; `null` when it has none (a record before task 001-265). */
export function readKeyMarks(value: unknown): KeyMarks | null {
  if (!isRecord(value)) return null;
  const marks: KeyMarks = {};
  for (const [id, mark] of Object.entries(value)) {
    if (!Array.isArray(mark) || !Number.isInteger(mark[0])) continue;
    marks[id] = [mark[0], typeof mark[1] === "string" ? mark[1] : null];
  }
  return marks;
}

/** Whether `marks` name every row as it is; none do without marks. */
export function marksVouch(marks: KeyMarks | null, rows: readonly TestFileKeyRecord[]): boolean {
  return marks !== null && rows.every((row) => same(marks[testFileId(row.testFile)], keyMark(row)));
}

/** Marks `rows` as written; whether a mark changed. */
export function markRows(marks: KeyMarks, rows: readonly TestFileKeyRecord[]): boolean {
  let changed = false;
  for (const row of rows) {
    const id = testFileId(row.testFile);
    const mark = keyMark(row);
    if (same(marks[id], mark)) continue;
    marks[id] = mark;
    changed = true;
  }
  return changed;
}
