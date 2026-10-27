import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { codeStorePath } from "../../../src/core/code/store/index.js";
import { markParts, PART_REFRESH_MS, sweepParts } from "../../../src/core/code/store/parts.js";
import type { CodePruneOptions } from "../../../src/core/code/store/types.js";
import { Connection } from "../../../src/core/store/connection.js";
import { commonDir, open } from "../helpers.js";
import { A, B, C, partRows, read, record, share, sql } from "./parts-fixtures.js";

/*
 * Row 015-85 (spec 015 D4): a coverage part is kept while any kept record
 * lists it, records at live keys older than the retention included, and
 * otherwise goes once it was last used before the retention cutoff. Each
 * case reads the kept records back, so a part deleted under one shows as a
 * source read unread.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY_MS;
const RETENTION = 7;
const CUTOFF = NOW - RETENTION * DAY_MS;

const prune = (store: ReturnType<typeof open>, resultKeys: string[], now = NOW) =>
  store.prune({
    now,
    retentionDays: RETENTION,
    worktrees: [],
    consumers: [],
    resultKeys,
  } satisfies CodePruneOptions);

const connections: Connection[] = [];
afterEach(() => {
  for (const conn of connections.splice(0)) conn.close();
});

/** A second connection to the store's file, as another daemon's prune holds. */
function other(dir: string): Connection {
  const conn = new Connection(new DatabaseSync(codeStorePath(dir)));
  connections.push(conn);
  return conn;
}

describe("the coverage parts' prune (row 015-85)", () => {
  it("keeps every part a record at a live key lists, however long ago it was stored", () => {
    const dir = commonDir();
    const store = open(dir);
    share(store, "live", record([A, B]), NOW - 30 * DAY_MS);
    share(store, "gone", record([A, C]), NOW - 30 * DAY_MS);

    const report = prune(store, ["live"]);
    const later = prune(store, ["live"], NOW + 30 * DAY_MS);

    expect(report).toMatchObject({ coverageRemoved: 1, partsRemoved: 1 });
    expect(later).toMatchObject({ coverageRemoved: 0, partsRemoved: 0 });
    expect(read(store, "live")).toEqual(record([A, B]));
    expect(partRows(dir)).toHaveLength(2);
  });

  it("drops a part no record lists once it was last used before the cutoff", () => {
    const dir = commonDir();
    const store = open(dir);
    share(store, "k1", record([A, B]), NOW - DAY_MS);
    share(store, "k2", record([A, C]), NOW - DAY_MS);

    // k1's result went: its record goes now, its own part once it is past the retention.
    expect(prune(store, ["k2"])).toMatchObject({ coverageRemoved: 1, partsRemoved: 0 });
    expect(partRows(dir)).toHaveLength(3);
    expect(prune(store, ["k2"], NOW + RETENTION * DAY_MS)).toMatchObject({ partsRemoved: 1 });

    expect(read(store, "k1")).toBeNull();
    expect(read(store, "k2")).toEqual(record([A, C]));
    expect(partRows(dir)).toHaveLength(2);
  });

  it("keeps a part a new record lists again after the record that stored it went", () => {
    const dir = commonDir();
    const store = open(dir);
    share(store, "old", record([A, B]), NOW - 30 * DAY_MS);
    share(store, "new", record([A]), NOW);
    const used = partRows(dir).map((p) => p.usedAt);

    expect(prune(store, ["new"])).toMatchObject({ coverageRemoved: 1, partsRemoved: 1 });
    expect(used).toEqual([NOW, NOW - 30 * DAY_MS]);
    expect(read(store, "new")).toEqual(record([A]));
  });

  it("moves a part's last use only when it is older than the refresh", () => {
    const dir = commonDir();
    const store = open(dir);
    share(store, "k1", record([A]), NOW);
    share(store, "k2", record([A]), NOW + PART_REFRESH_MS - 1);
    expect(partRows(dir).map((p) => p.usedAt)).toEqual([NOW]);
    share(store, "k3", record([A]), NOW + PART_REFRESH_MS + 1);
    expect(partRows(dir).map((p) => p.usedAt)).toEqual([NOW + PART_REFRESH_MS + 1]);
  });

  it("keeps a part a record stored between another daemon's mark and its sweep lists", () => {
    const dir = commonDir();
    const store = open(dir);
    share(store, "old", record([A, B]), NOW - 30 * DAY_MS);
    sql(dir, "DELETE FROM coverage WHERE result_key = ?", "old");
    const prunes = other(dir);

    const marked = markParts(prunes, CUTOFF + PART_REFRESH_MS);
    share(store, "new", record([A]), NOW);
    const removed = sweepParts(prunes, CUTOFF, marked, 256);

    expect(marked.size).toBe(0);
    expect(removed).toBe(1);
    expect(read(store, "new")).toEqual(record([A]));
  });

  // The one case the invariant does not cover, kept as an assumption (`src/core/code/store/parts.ts`).
  it("reads a source unread, never as not run, when a clock moved back past the retention lost its part", () => {
    const dir = commonDir();
    const store = open(dir);
    share(store, "old", record([A, B]), NOW - 30 * DAY_MS);
    sql(dir, "DELETE FROM coverage WHERE result_key = ?", "old");
    const prunes = other(dir);

    const marked = markParts(prunes, CUTOFF + PART_REFRESH_MS);
    // A record stored with the clock 29 days back gives its parts that time as their last use.
    share(store, "back", record([A, C]), NOW - 29 * DAY_MS);
    sweepParts(prunes, CUTOFF, marked, 256);

    expect(read(store, "back")).toEqual(record([], ["src/a.ts", "src/c.ts"]));
  });

  it("prunes nothing of the parts in a store made before them", () => {
    const dir = commonDir();
    const store = open(dir);
    store.close();
    sql(dir, "DROP TABLE coverage_parts");
    const reopened = open(dir, { create: false });

    expect(prune(reopened, [])).toMatchObject({ partsRemoved: 0 });
  });
});
