import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkpointPassively,
  PASSIVE_CHECKPOINT_BYTES,
  PASSIVE_CHECKPOINT_MS,
  passiveCheckpoint,
} from "../../src/core/daemon/idle-checkpoint.js";

/* Spec 024 D5: a managed connection's WAL is checkpointed passively between its transactions. */

const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A WAL database whose connection never checkpoints at a commit, and its `-wal` path. */
function managedDatabase(): { db: DatabaseSync; path: string; wal: string } {
  const dir = mkdtempSync(join(tmpdir(), "squeal-passive-"));
  const path = join(dir, "store.sqlite");
  const db = new DatabaseSync(path);
  cleanups.push(() => {
    if (db.isOpen) db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0");
  db.exec("CREATE TABLE n (v BLOB NOT NULL)");
  return { db, path, wal: `${path}-wal` };
}

/** Commits `bytes` of rows on `db`. */
function fill(db: DatabaseSync, bytes: number): void {
  const insert = db.prepare("INSERT INTO n (v) VALUES (randomblob(?))");
  db.exec("BEGIN IMMEDIATE");
  for (let left = bytes; left > 0; left -= 64 * 1024) insert.run(64 * 1024);
  db.exec("COMMIT");
}

describe("passiveCheckpoint", () => {
  it("runs nothing while the WAL is small or a transaction is open", () => {
    const { db, wal } = managedDatabase();
    fill(db, 64 * 1024);
    expect(statSync(wal).size).toBeLessThan(PASSIVE_CHECKPOINT_BYTES);
    expect(passiveCheckpoint(db, wal)).toBeNull();
    expect(passiveCheckpoint(db, join(wal, "missing"), 0)).toBeNull();

    fill(db, PASSIVE_CHECKPOINT_BYTES);
    db.exec("BEGIN");
    try {
      expect(passiveCheckpoint(db, wal)).toBeNull();
    } finally {
      db.exec("COMMIT");
    }
  });

  it("copies the whole WAL once it is large", () => {
    const { db, wal } = managedDatabase();
    fill(db, PASSIVE_CHECKPOINT_BYTES);
    const done = passiveCheckpoint(db, wal);
    expect(done).toMatchObject({ busy: false });
    expect(done?.log).toBeGreaterThan(1_000);
    expect(done?.checkpointed).toBe(done?.log);
  });

  it("never waits for a writer that holds the lock", () => {
    const { db, path, wal } = managedDatabase();
    fill(db, PASSIVE_CHECKPOINT_BYTES);
    db.exec("PRAGMA busy_timeout = 5000");
    const writer = new DatabaseSync(path);
    writer.exec("BEGIN IMMEDIATE; INSERT INTO n (v) VALUES (x'00')");
    try {
      const started = performance.now();
      const done = passiveCheckpoint(db, wal);
      expect(performance.now() - started).toBeLessThan(1_000);
      // Frames the writer has not committed are no part of it; the committed ones are copied.
      expect(done?.checkpointed).toBe(done?.log);
    } finally {
      writer.exec("ROLLBACK");
      writer.close();
    }
  });
});

describe("checkpointPassively", () => {
  it("checks on its timer and stops once the connection is closed", () => {
    vi.useFakeTimers();
    const { db, wal } = managedDatabase();
    fill(db, PASSIVE_CHECKPOINT_BYTES);
    const prepared: string[] = [];
    const real = DatabaseSync.prototype.prepare;
    vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      prepared.push(sql);
      return real.call(this, sql);
    });
    const checkpoints = () => prepared.filter((sql) => /wal_checkpoint\(PASSIVE\)/.test(sql));

    checkpointPassively(db, wal);
    vi.advanceTimersByTime(PASSIVE_CHECKPOINT_MS - 1);
    expect(checkpoints()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(checkpoints()).toHaveLength(1);

    db.close();
    vi.advanceTimersByTime(PASSIVE_CHECKPOINT_MS);
    expect(vi.getTimerCount()).toBe(0);
    expect(checkpoints()).toHaveLength(1);
  });

  it("stops when told to", () => {
    vi.useFakeTimers();
    const { db, wal } = managedDatabase();
    const stop = checkpointPassively(db, wal);
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
