import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { codeStorePath } from "../../src/core/code/store/open.js";
import { commonDir, count, open } from "./helpers.js";

/*
 * Row 005-103: the uncounted-files read (`files.uncounted`) looks each included file up in
 * `counts`, whose rows hold the functions' JSON (3.5 to 7.9 KB each on the 005-101 copies): 97
 * to 193 ms for 0 rows at a session start. A key-only index (`counts_keys`, made at open as
 * `CODE_INDEXES` are, row 015-44) cuts it to about 3 ms, but SQLite's planner keeps the primary
 * key unless the read names the index. The read names it only when the file has it: a store a
 * reader opened first (`create: false`) has none, and the answer is the same either way.
 */

const WT = "wt-1";
const file = (path: string, blob: string, tooBig = false) => ({
  path,
  blob,
  language: "typescript" as const,
  counterVersion: 1,
  size: 10,
  revision: 1,
  ...(tooBig ? { tooBig } : {}),
});

/** A store with two files counted, two not, one too big; `counts_keys` dropped when `bare`. */
function seeded(bare: boolean): string {
  const dir = commonDir();
  const store = open(dir);
  store.counts.put(count("b1"), 1);
  store.counts.put(count("b3"), 1);
  store.files.upsertMany(WT, [
    file("a.ts", "b1"),
    file("b.ts", "b2"),
    file("c.ts", "b3"),
    file("d.ts", "b4"),
    file("e.ts", "b5", true),
  ]);
  store.close();
  if (bare) {
    const db = new DatabaseSync(codeStorePath(dir));
    db.exec("DROP INDEX counts_keys");
    db.close();
  }
  return dir;
}

/** The plan of `files.uncounted`'s statement (`src/core/code/store/counts.ts`), with the index named or not. */
function uncountedPlan(dir: string, indexed: boolean): string {
  const db = new DatabaseSync(codeStorePath(dir), { readOnly: true });
  try {
    const counts = indexed ? "counts c INDEXED BY counts_keys" : "counts c";
    return db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT * FROM files f WHERE f.worktree_id = ? AND f.too_big = 0
           AND NOT EXISTS (SELECT 1 FROM ${counts} WHERE c.blob = f.blob
             AND c.language = f.language AND c.counter_version = f.counter_version)
         ORDER BY f.path`,
      )
      .all(WT)
      .map((row) => String(row.detail))
      .join(" | ");
  } finally {
    db.close();
  }
}

describe("the uncounted-files read (row 005-103)", () => {
  it("names the key-only index, which serves each lookup", () => {
    const dir = seeded(false);
    const store = open(dir);
    expect(store.files.uncounted(WT).map((f) => f.path)).toEqual(["b.ts", "d.ts"]);
    expect(uncountedPlan(dir, true)).toMatch(/SEARCH c USING COVERING INDEX counts_keys/);
    // Without the name the planner keeps the wide primary key: why the read names the index.
    expect(uncountedPlan(dir, false)).not.toMatch(/counts_keys/);
  });

  it("gives the same answer without the index, and a reader does not make it", () => {
    const dir = seeded(true);
    const reader = open(dir, { create: false });
    expect(reader.files.uncounted(WT).map((f) => f.path)).toEqual(["b.ts", "d.ts"]);
    reader.close();
    const db = new DatabaseSync(codeStorePath(dir), { readOnly: true });
    const found = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'counts_keys'").get();
    db.close();
    expect(found).toBeUndefined();
    expect(
      open(dir)
        .files.uncounted(WT)
        .map((f) => f.path),
    ).toEqual(["b.ts", "d.ts"]);
  });
});
