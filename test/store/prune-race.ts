import { expect } from "vitest";
import type { Connection } from "../../src/core/store/connection.js";
import type { PruneSlice } from "../../src/core/store/prune.js";

/**
 * Runs `slices`; once `table`'s keys were read (a `SELECT` of `conn` from
 * it, in a slice or as the next one was made), runs `between` before the
 * next slice runs, which deletes them.
 */
export function raceAfterRead(
  conn: Connection,
  slices: Iterable<PruneSlice>,
  table: string,
  between: () => void,
): void {
  const all = conn.all.bind(conn);
  let read = false;
  conn.all = (sql, ...params) => {
    if (new RegExp(`^SELECT [\\w\\s,]*? FROM ${table}\\b`).test(sql.trim())) read = true;
    return all(sql, ...params);
  };
  let raced = false;
  const race = () => {
    if (!read || raced) return;
    between();
    raced = true;
  };
  for (const slice of slices) {
    race();
    slice();
    race();
  }
  expect(raced).toBe(true);
}
