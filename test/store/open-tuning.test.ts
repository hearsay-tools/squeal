import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectConnection, isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import { SCHEMA_VERSION } from "../../src/core/store/schema.js";
import type { Store } from "../../src/core/types/store.js";
import { fakeCommonDir, open } from "./helpers.js";

/* Spec 024 D5: connection pragmas, managed checkpoints and the fast non-creating open. */

const realPrepare = DatabaseSync.prototype.prepare;
const realExec = DatabaseSync.prototype.exec;

afterEach(() => {
  vi.restoreAllMocks();
});

/** The store `options` open, and the SQL every connection prepared or ran during that open. */
function openSeen(commonDir: string, options: Parameters<typeof openStore>[1]) {
  const sql: string[] = [];
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
    this: DatabaseSync,
    text: string,
  ) {
    sql.push(text);
    return realPrepare.call(this, text);
  });
  vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
    this: DatabaseSync,
    text: string,
  ) {
    sql.push(text);
    return realExec.call(this, text);
  });
  let store: ReturnType<typeof openStore>;
  try {
    store = openStore(commonDir, options);
  } finally {
    vi.restoreAllMocks();
  }
  if (isStoreOpenFailure(store)) throw new Error(`open failed: ${JSON.stringify(store)}`);
  return { store, sql };
}

function closing<T>(store: Store, fn: (store: Store) => T): T {
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

describe("openStore connection tuning (spec 024 D5)", () => {
  it("gives every connection a 16 MiB page cache and in-memory temp storage", () => {
    const commonDir = fakeCommonDir();
    open(commonDir).close();
    for (const options of [{}, { create: false }]) {
      const store = openStore(commonDir, options);
      if (isStoreOpenFailure(store)) throw new Error("open failed");
      closing(store, () => {
        // temp_store 2 is MEMORY; SQLite's default auto-checkpoint stays on.
        expect(inspectConnection(store)).toMatchObject({
          cacheSize: -16384,
          tempStore: 2,
          walAutocheckpoint: 1000,
        });
      });
    }
  });

  it("turns commit checkpoints off only on a managed connection", () => {
    const commonDir = fakeCommonDir();
    const managed = openStore(commonDir, { managedCheckpoint: true });
    if (isStoreOpenFailure(managed)) throw new Error("open failed");
    closing(managed, () => {
      expect(inspectConnection(managed).walAutocheckpoint).toBe(0);
      const other = openStore(commonDir, { create: false });
      if (isStoreOpenFailure(other)) throw new Error("open failed");
      // Per connection: a hook beside the daemon still checkpoints at its commits.
      closing(other, () => expect(inspectConnection(other).walAutocheckpoint).toBe(1000));
    });
  });

  it("opens a current store without creating, reading only two pragmas and writing nothing", () => {
    const commonDir = fakeCommonDir();
    open(commonDir).meta.set("kept", "yes");

    const { store, sql } = openSeen(commonDir, { create: false });
    closing(store, () => {
      expect(store.schemaVersion).toBe(SCHEMA_VERSION);
      expect(store.meta.get("kept")).toBe("yes");
      expect(sql.filter((text) => /page_count|journal_mode\s*=|BEGIN/i.test(text))).toEqual([]);
      expect(sql).toContain("PRAGMA journal_mode");
    });
  });

  it("still switches a current store that is not in WAL", () => {
    const commonDir = fakeCommonDir();
    open(commonDir).close();
    const raw = new DatabaseSync(storePaths(commonDir).database);
    raw.exec("PRAGMA journal_mode = DELETE");
    raw.close();

    const { store, sql } = openSeen(commonDir, { create: false });
    closing(store, () => {
      expect(inspectConnection(store).journalMode).toBe("wal");
      expect(sql).toContain("PRAGMA journal_mode = WAL");
    });
  });

  it("keeps the full open for an opener that may create the store", () => {
    const commonDir = fakeCommonDir();
    open(commonDir).close();
    const { store, sql } = openSeen(commonDir, {});
    closing(store, () => {
      expect(sql).toContain("PRAGMA page_count");
      expect(sql).toContain("PRAGMA journal_mode = WAL");
    });
  });
});
