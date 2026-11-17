import { renameSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { storeFaults, watched } from "../../src/core/daemon/store-fault.js";
import { type StoreFile, storeFileOf } from "../../src/core/daemon/store-file.js";
import { markStore, readStoreMark } from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import { fakeCommonDir, open } from "../store/helpers.js";

/*
 * Row 011-391: the one classifier of a daemon's store errors. Corruption
 * (SQLITE_CORRUPT, SQLITE_NOTADB) marks the store, found by `daemon`, and
 * stops the daemon once; any other error is the caller's to log.
 */

const CORRUPT = Object.assign(new Error("database disk image is malformed"), { errcode: 11 });
const NOT_A_DB = Object.assign(new Error("file is not a database"), { errcode: 26 });
const BUSY = Object.assign(new Error("database is locked"), { errcode: 5 });

function faults(commonDir: string, storeFile: StoreFile | null) {
  const stops: string[] = [];
  const logs: string[] = [];
  const seen = storeFaults({
    commonDir,
    storeFile,
    now: () => 7,
    log: (line) => void logs.push(line),
    stop: (text) => void stops.push(text),
  });
  return { seen, stops, logs };
}

function store(): { commonDir: string; file: StoreFile } {
  const commonDir = fakeCommonDir();
  open(commonDir);
  const file = storeFileOf(commonDir);
  if (file === null) throw new Error("no store file");
  return { commonDir, file };
}

describe("storeFaults (row 011-391)", () => {
  it("marks the store and stops once on corruption; other errors are not its", () => {
    const { commonDir, file } = store();
    const { seen, stops } = faults(commonDir, file);

    expect(seen(BUSY)).toBe(false);
    expect(seen(new Error("plain"))).toBe(false);
    expect(stops).toEqual([]);
    expect(readStoreMark(commonDir)).toBeNull();

    expect(seen(CORRUPT)).toBe(true);
    expect(readStoreMark(commonDir)).toEqual({
      at: 7,
      problem: "Error: database disk image is malformed",
      found: "daemon",
    });
    expect(stops).toEqual([
      expect.stringMatching(
        /^daemon stopped: a daemon's read or write of the store found a fault \(Error: database disk image is malformed\); every daemon on this store stops/,
      ),
    ]);

    expect(seen(NOT_A_DB)).toBe(true);
    expect(stops).toHaveLength(1);
  });

  it("leaves a mark already there", () => {
    const { commonDir, file } = store();
    markStore(commonDir, { at: 1, problem: "row 1 missing", found: "full-check" });
    const { seen, stops } = faults(commonDir, file);

    expect(seen(CORRUPT)).toBe(true);
    expect(readStoreMark(commonDir)).toEqual({
      at: 1,
      problem: "row 1 missing",
      found: "full-check",
    });
    expect(stops).toHaveLength(1);
  });

  it("marks no file but its own: another start moved the one it opened aside", () => {
    const { commonDir, file } = store();
    const { database } = storePaths(commonDir);
    renameSync(database, `${database}.corrupt-1`);
    open(commonDir);
    const { seen, stops } = faults(commonDir, file);

    expect(seen(CORRUPT)).toBe(true);
    expect(readStoreMark(commonDir)).toBeNull();
    expect(stops).toHaveLength(1);
  });

  it("stops even when the mark cannot be written, and logs why", () => {
    const { commonDir, file } = store();
    const { seen, stops, logs } = faults(commonDir, file);
    const { database } = storePaths(commonDir);
    // A directory where the mark's file goes: the write fails.
    open(commonDir);
    const markPath = `${database}.check-failed`;
    renameSync(fakeCommonDir(), markPath);

    expect(seen(CORRUPT)).toBe(true);
    expect(stops).toHaveLength(1);
    expect(logs).toEqual([expect.stringContaining("could not mark the store")]);
  });
});

describe("watched (row 011-391)", () => {
  it("shows a throw and a rejection to the classifier and passes them on", async () => {
    const shown: unknown[] = [];
    const seen = (error: unknown) => {
      shown.push(error);
      return true;
    };
    expect(() =>
      watched(seen, () => {
        throw CORRUPT;
      })(),
    ).toThrow(CORRUPT);
    await expect(watched(seen, async () => Promise.reject(BUSY))()).rejects.toBe(BUSY);
    expect(await watched(seen, async (n: number) => n + 1)(1)).toBe(2);
    expect(watched(seen, (n: number) => n * 2)(4)).toBe(8);
    expect(shown).toEqual([CORRUPT, BUSY]);
  });
});
