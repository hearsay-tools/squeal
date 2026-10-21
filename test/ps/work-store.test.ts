import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { discover } from "../../src/core/ps/discover.js";
import { createProcSource } from "../../src/core/ps/proc.js";
import type { PsSource } from "../../src/core/ps/source.js";
import { readWork } from "../../src/core/ps/work.js";
import { isStoreOpenFailure, lockFileFor, openStore } from "../../src/core/store/index.js";
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
 * Spec 014 goal 4 and D3 (tasks 014-23, 014-26): `ps` reads a store and
 * leaves it as it found it. A store no connection holds open has no `-wal`
 * and `-shm`, and SQLite's WAL reader would create both (`lessons.md` P6),
 * so such a store is read from its database file alone. The open runs of a
 * store are one query per reading, whatever its daemons.
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
/** A second worktree of `repo`'s store: its own root and lock, the same common dir. */
function linked(repo: FixtureRepo, name: string): FixtureRepo {
  const root = join(host.base, name);
  mkdirSync(root);
  const id = worktreeIdFor(root);
  const lockPath = lockFileFor(repo.commonDir, id);
  writeFileSync(lockPath, "");
  return { root, commonDir: repo.commonDir, id, lockPath, storePath: repo.storePath };
}
/** The files a writer that died after `commit` leaves: the database file without it, the -wal with it, no -shm. */
function crashImage(repo: FixtureRepo, commit: (store: Store) => void): void {
  const files = [repo.storePath, `${repo.storePath}-wal`];
  const writer = openStore(repo.commonDir);
  if (isStoreOpenFailure(writer)) throw new Error(JSON.stringify(writer));
  let image: Buffer[];
  try {
    commit(writer);
    image = files.map((f) => readFileSync(f));
  } finally {
    // Its clean close checkpoints and removes -wal and -shm; the image is written back over it.
    writer.close();
  }
  for (const [i, f] of files.entries()) writeFileSync(f, image[i] ?? "");
}
/** The heartbeat a WAL reader reads from a copy of `repo`'s store files, which it may extend. */
function heartbeatOfCopy(repo: FixtureRepo): number {
  const dir = join(host.base, "copy");
  mkdirSync(dir);
  for (const suffix of ["", "-wal"])
    copyFileSync(`${repo.storePath}${suffix}`, join(dir, `store.sqlite${suffix}`));
  const db = new DatabaseSync(join(dir, "store.sqlite"), { readOnly: true });
  try {
    const row = db.prepare("SELECT daemon_heartbeat_at AS at FROM worktrees WHERE id = ?");
    return Number(row.get(repo.id)?.at);
  } finally {
    db.close();
  }
}
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

  test("a crash image, a -wal with a commit newer than the file and no -shm, is unknown, never the old value", () => {
    serve(alpha);
    writeStore(alpha, daemonRecord(alpha));
    const newer = daemonRecord(alpha, { heartbeatAt: STARTED_AT + 120_000 });
    crashImage(alpha, (store) => store.worktrees.setDaemon(alpha.id, newer));
    const before = listing(alpha);
    expect(before).toEqual(["locks", "store.sqlite", "store.sqlite-wal"]);
    expect(heartbeatOfCopy(alpha)).toBe(newer.heartbeatAt);

    const { work, unknown } = read();
    expect(work.has(800)).toBe(false);
    expect(unknown).toEqual([
      {
        what: "daemon 800 work",
        why: `its store ${alpha.storePath} has a WAL whose commits cannot be read without creating its -shm`,
      },
    ]);
    expect(listing(alpha)).toEqual(before);
  });

  test("an empty -wal without -shm, as a connection opens, is read from the file and left as it was", () => {
    serve(alpha);
    writeStore(alpha, daemonRecord(alpha));
    writeFileSync(`${alpha.storePath}-wal`, "");
    const before = listing(alpha);

    expect(read().work.get(800)?.record).toEqual(daemonRecord(alpha));
    expect(listing(alpha)).toEqual(before);
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

describe("the open runs", () => {
  test("are one query per store and reading, each worktree's split from it", () => {
    const beta = linked(alpha, "alpha-b");
    const gamma = linked(alpha, "alpha-c");
    serve(alpha, beta, gamma);
    writeStore(alpha, daemonRecord(alpha), (store) => openRun(store, alpha, "a1"));
    writeStore(beta, daemonRecord(beta), (store) => {
      openRun(store, beta, "b1");
      openRun(store, beta, "b2");
    });
    writeStore(gamma, daemonRecord(gamma));
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");

    const { work } = read();
    const runQueries = prepare.mock.calls.filter(([sql]) => /\bFROM runs\b/.test(sql));
    expect(runQueries).toHaveLength(1);
    expect([800, 801, 802].map((pid) => work.get(pid)?.tiers.map((t) => t.runId))).toEqual([
      ["a1"],
      ["b1", "b2"],
      [],
    ]);
  });
});
