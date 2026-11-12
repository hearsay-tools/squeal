import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { isBusy, observeWrites } from "../../src/core/store/connection.js";
import { listImports } from "../../src/core/store/imports.js";
import { storePaths } from "../../src/core/store/paths.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import {
  ImportStopped,
  importResults,
  importSliced,
  retriedSlice,
} from "../../src/core/store/transfer-import.js";
import { IMPORT_SLICE_RESULTS } from "../../src/core/store/transfer-import-slices.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import type { Store } from "../../src/core/types/store.js";
import { fakeCommonDir, open } from "./helpers.js";

/*
 * Spec 021 D3 (row 021-20): an import writes in slices, each one short
 * transaction tried again while a busy store refuses it, in place of one
 * transaction over the whole bundle. A lock held for less than the bound
 * costs the import a wait, not a failure, and the event loop runs through
 * it; one held past the bound fails the import at the bound. The import's
 * record is written last, so one that stopped between slices reads as not
 * held and the next import adds the rest.
 */

/** Files in the bundle; each has `TESTS` results at its own key. */
const FILES = 3 * Math.ceil(IMPORT_SLICE_RESULTS / 100);
const TESTS = 100;
const OPTIONS = { importId: "imp0123456789abc", fileHash: "f".repeat(64), now: 1_000 } as const;

const keyOf = (file: number) => `key-${file}` as CheckKey;
const pathOf = (file: number) => `t/f${file}.test.ts`;

function bundle(files = FILES): ResultsBundle {
  return {
    format: "squeal-results/1",
    header: {
      squealVersion: "0.0.0-test",
      keyFormat: KEY_FORMAT_VERSION,
      commit: "c".repeat(40),
      dirty: false,
      createdAt: 1,
      source: { kind: "local" },
    },
    environments: [],
    testFiles: Array.from({ length: files }, (_, f) => ({
      project: "",
      path: pathOf(f),
      key: keyOf(f),
      closure: null,
      observed: {},
    })),
    observedStartup: [],
    results: Array.from({ length: files * TESTS }, (_, i) => {
      const f = Math.floor(i / TESTS);
      return {
        project: "",
        testPath: pathOf(f),
        kind: "test" as const,
        fullName: `test ${i % TESTS}`,
        location: null,
        key: keyOf(f),
        outcome: "pass" as const,
        durationMs: 1,
      };
    }),
  };
}

function storeAndFile(): { store: Store; database: string } {
  const commonDir = fakeCommonDir();
  return { store: open(commonDir), database: storePaths(commonDir).database };
}

/** Holds the store's write lock from another connection of this thread until `release`. */
function hold(database: string): () => void {
  const db = new DatabaseSync(database);
  db.exec("BEGIN IMMEDIATE");
  return () => {
    db.exec("COMMIT");
    db.close();
  };
}

/** The longest gap between ticks of a 10 ms timer while `work` runs: how long the event loop stood. */
async function longestStall<T>(work: () => Promise<T>): Promise<{ value: T; stallMs: number }> {
  let last = performance.now();
  let stallMs = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    stallMs = Math.max(stallMs, now - last);
    last = now;
  }, 10);
  try {
    return { value: await work(), stallMs };
  } finally {
    clearInterval(timer);
  }
}

const resultRows = (store: Store) => store.results.keysSince(0).map(({ key }) => key);

/** Each key's distinct record times. */
const timesByKey = (store: Store) =>
  connectionOf(store)
    .all(
      "SELECT key, COUNT(DISTINCT recorded_at) AS n, MIN(recorded_at) AS at FROM results GROUP BY key",
    )
    .map((row) => ({ n: Number(row.n), at: Number(row.at) }));

describe("an import in slices (021 D3, row 021-20)", () => {
  it("adds what one transaction added, in more than one write transaction", async () => {
    const { store } = storeAndFile();
    const once = storeAndFile().store;
    let transactions = 0;
    observeWrites(() => {
      transactions++;
      return null;
    });
    let counts: Awaited<ReturnType<typeof importSliced>>;
    try {
      counts = await importSliced(store, bundle(), OPTIONS);
    } finally {
      observeWrites(null);
    }
    expect(counts).toEqual(importResults(once, bundle(), { ...OPTIONS, dryRun: true }));
    expect(counts).toMatchObject({ results: FILES * TESTS, alreadyStored: 0 });
    expect(transactions).toBeGreaterThanOrEqual(3);
    expect(listImports(store).map((i) => i.id)).toEqual([OPTIONS.importId]);
  });

  it("waits out a lock held under the bound, and the event loop runs meanwhile", async () => {
    const { store, database } = storeAndFile();
    const release = hold(database);
    const freed = setTimeout(release, 1_500);
    const started = performance.now();
    const { value, stallMs } = await longestStall(() => importSliced(store, bundle(), OPTIONS));
    clearTimeout(freed);
    expect(performance.now() - started).toBeGreaterThanOrEqual(1_400);
    expect(value).toMatchObject({ results: FILES * TESTS, alreadyStored: 0 });
    // One try waits at most the 250 ms slice; a slice's own write is short.
    expect(stallMs).toBeLessThan(1_000);
  });

  it("fails at the bound under a lock held past it, and the next import adds the rest", async () => {
    const { store, database } = storeAndFile();
    // The first results slice commits, then the lock is taken from another connection.
    let slices = 0;
    let release: (() => void) | null = null;
    const started = performance.now();
    const error = await importSliced(store, bundle(), {
      ...OPTIONS,
      run: async (slice) => {
        if (slice.what === "an import's results" && ++slices === 2) release = hold(database);
        await retriedSlice(600)(slice);
      },
    }).catch((e: unknown) => e);
    expect(isBusy(error)).toBe(true);
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(listImports(store)).toEqual([]);
    const partial = new Set(resultRows(store));
    expect(partial.size).toBeGreaterThan(0);
    expect(partial.size).toBeLessThan(FILES);
    (release as (() => void) | null)?.();

    const rest = await importSliced(store, bundle(), OPTIONS);
    expect(rest.results + rest.alreadyStored).toBe(FILES * TESTS);
    expect(rest.alreadyStored).toBe(partial.size * TESTS);
    expect(listImports(store).map((i) => i.id)).toEqual([OPTIONS.importId]);
  });

  it("writes the import's record last: one stopped between slices is not held", async () => {
    const { store } = storeAndFile();
    let ran = 0;
    const error = await importSliced(store, bundle(), {
      ...OPTIONS,
      run: async (slice) => {
        ran++;
        slice.run();
      },
      stopped: () => ran >= 3,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportStopped);
    expect(listImports(store)).toEqual([]);
    const again = await importSliced(store, bundle(), OPTIONS);
    expect(again.results + again.alreadyStored).toBe(FILES * TESTS);
    expect(listImports(store)).toHaveLength(1);
  });

  it("keeps a key's results in one slice, and times each slice inside its transaction", async () => {
    const { store } = storeAndFile();
    let clock = 5_000;
    const whats: string[] = [];
    await importSliced(store, bundle(), {
      ...OPTIONS,
      clock: () => clock++,
      run: async (slice) => {
        whats.push(slice.what);
        slice.run();
      },
    });
    const times = timesByKey(store);
    expect(times).toHaveLength(FILES);
    expect(times.every(({ n }) => n === 1)).toBe(true);
    const resultSlices = whats.filter((w) => w === "an import's results").length;
    expect(resultSlices).toBeGreaterThanOrEqual(3);
    expect(new Set(times.map(({ at }) => at)).size).toBe(resultSlices);
    expect(whats.at(-1)).toBe("an import's record");
  });

  it("writes nothing on a dry run, with the counts of the import", async () => {
    const { store } = storeAndFile();
    const dry = await importSliced(store, bundle(), { ...OPTIONS, dryRun: true });
    expect(resultRows(store)).toEqual([]);
    expect(listImports(store)).toEqual([]);
    expect(await importSliced(store, bundle(), OPTIONS)).toEqual(dry);
  });
});
