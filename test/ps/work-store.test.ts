import { readdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { discover } from "../../src/core/ps/discover.js";
import { createProcSource } from "../../src/core/ps/proc.js";
import type { PsSource } from "../../src/core/ps/source.js";
import { readWork } from "../../src/core/ps/work.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import type { Store } from "../../src/core/types/index.js";
import {
  daemonProcess,
  daemonRecord,
  type FixtureHost,
  type FixtureRepo,
  lockLine,
  makeHost,
  makeRepo,
  STARTED_AT,
  writeLocks,
  writeProcesses,
  writeStore,
} from "./fixture-stores.js";

/*
 * Spec 014 goal 4 and D3 (task 014-26): `ps` reads a store and
 * leaves it as it found it. A store no connection holds open has no `-wal`
 * and `-shm`, and SQLite's WAL reader would create both (`lessons.md` P6),
 * so such a store is read from its database file alone.
 */

let host: FixtureHost;
let alpha: FixtureRepo;
let source: PsSource;

beforeEach(() => {
  host = makeHost();
  alpha = makeRepo(host.base, "alpha");
  source = createProcSource({ root: host.base, run: () => null });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(host.base, { recursive: true, force: true });
});

const key = (path: string): string => source.fileKey(path) ?? "";
/** Daemons of `repos`, pids from 800, each holding its lock. */
function serve(...repos: FixtureRepo[]): void {
  writeProcesses(
    host,
    repos.map((r, i) => daemonProcess({ pid: 800 + i, root: r.root, lockPath: r.lockPath })),
  );
  writeLocks(
    host,
    repos.map((r, i) => lockLine(i + 1, 800 + i, key(r.lockPath))),
  );
}
function read() {
  const table = source.processTable();
  return readWork(source, table, discover(source, table, host.places).daemons);
}
const listing = (repo: FixtureRepo): string[] => readdirSync(dirname(repo.storePath)).sort();
function openRun(store: Store, repo: FixtureRepo, id: string): void {
  store.runs.start({
    id,
    worktreeId: repo.id,
    revision: 1,
    testFiles: [{ project: "default", path: "test/a.test.ts" }],
    checkpointId: null,
    logDir: "/tmp/runs",
    startedAt: STARTED_AT + 5_000,
  });
}

describe("a read creates no file", () => {
  test("a store no connection holds open, without -wal and -shm, is read and left as it was", () => {
    serve(alpha);
    writeStore(alpha, daemonRecord(alpha), (store) => openRun(store, alpha, "edit"));
    const before = listing(alpha);
    expect(before).toEqual(["locks", "store.sqlite"]);

    const { work, unknown } = read();
    expect(unknown.filter((u) => u.what === "daemon 800 work")).toEqual([]);
    expect(work.get(800)?.record).toEqual(daemonRecord(alpha));
    expect(work.get(800)?.tiers.map((t) => t.runId)).toEqual(["edit"]);
    expect(listing(alpha)).toEqual(before);
  });

  test("a store a writer holds open is read through its WAL, with the commits not yet in the file", () => {
    serve(alpha);
    writeStore(alpha, null);
    const writer = openStore(alpha.commonDir);
    if (isStoreOpenFailure(writer)) throw new Error(JSON.stringify(writer));
    try {
      writer.worktrees.setDaemon(alpha.id, daemonRecord(alpha));
      const before = listing(alpha);
      expect(before).toEqual(["locks", "store.sqlite", "store.sqlite-shm", "store.sqlite-wal"]);

      expect(read().work.get(800)?.record).toEqual(daemonRecord(alpha));
      expect(listing(alpha)).toEqual(before);
    } finally {
      writer.close();
    }
  });

  test("a store that changes while it is read without its WAL is unknown, never a mix", () => {
    serve(alpha);
    writeStore(alpha, daemonRecord(alpha));
    const prepare = DatabaseSync.prototype.prepare;
    let changed = false;
    vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      // A hook opens, writes and closes the store, which checkpoints into its file.
      if (!changed && sql.includes("FROM worktrees")) {
        changed = true;
        writeStore(alpha, daemonRecord(alpha, { heartbeatAt: STARTED_AT + 120_000 }));
      }
      return prepare.call(this, sql);
    });

    const { work, unknown } = read();
    expect(changed).toBe(true);
    expect(work.has(800)).toBe(false);
    expect(unknown).toEqual([
      {
        what: "daemon 800 work",
        why: `its store ${alpha.storePath} changed while it was read without its WAL`,
      },
    ]);
  });
});
