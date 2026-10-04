import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { storePaths } from "../../src/core/store/index.js";
import { report, spawnWorker } from "./child/spawn.js";
import { fakeCommonDir, open } from "./helpers.js";

const WRITERS = 4;
const READERS = 4;
const TRANSACTIONS = 200;
const ROWS_PER_TX = 50;

interface ReaderReport {
  reads: number;
  regressions: number;
  partialTransactions: number;
}

describe("store under concurrent processes (spec 001 D8, goal 7)", () => {
  it(`${WRITERS} writers and ${READERS} readers lose no updates`, async () => {
    // No store exists yet: every child races to create and migrate it.
    const commonDir = fakeCommonDir();
    const readers = Array.from({ length: READERS }, (_, i) =>
      spawnWorker(["reader", commonDir, String(i)]),
    );
    // On a slow runner a reader can still be starting when the writers finish; wait until every
    // reader is open and looping so the reads below really overlap the writes.
    await Promise.all(readers.map((reader) => reader.waitFor("ready")));
    const writers = Array.from({ length: WRITERS }, (_, i) =>
      spawnWorker(["writer", commonDir, String(i), String(TRANSACTIONS), String(ROWS_PER_TX)]),
    );

    for (const writer of writers) report(await writer.done);
    writeFileSync(join(commonDir, "stop"), "");
    const readerReports = await Promise.all(
      readers.map(async (reader) => report<ReaderReport>(await reader.done)),
    );

    const store = open(commonDir);
    expect(store.meta.get("counter")).toBe(String(WRITERS * TRANSACTIONS));
    for (let w = 0; w < WRITERS; w++) {
      for (let tx = 0; tx < TRANSACTIONS; tx++) {
        expect(store.results.byKey(`writer-${w}-tx-${tx}`)).toHaveLength(ROWS_PER_TX);
      }
    }
    const raw = new DatabaseSync(storePaths(commonDir).database, { readOnly: true });
    expect(raw.prepare("SELECT count(*) AS n FROM results").get()?.n).toBe(
      WRITERS * TRANSACTIONS * ROWS_PER_TX,
    );
    expect(raw.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
    raw.close();

    for (const r of readerReports) {
      expect(r.reads).toBeGreaterThan(0);
      expect(r.regressions).toBe(0);
      expect(r.partialTransactions).toBe(0);
    }
  }, 180_000);
});
