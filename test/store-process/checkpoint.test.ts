import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PASSIVE_CHECKPOINT_BYTES } from "../../src/core/daemon/idle-checkpoint.js";
import { batchSeq } from "../../src/core/store-process/guard.js";
import {
  CheckpointingWriter,
  openWriteConnection,
  WRITER_CHECKPOINT_MS,
} from "../../src/core/store-process/writer.js";
import { fakeCommonDir } from "../store/helpers.js";

/*
 * Spec 024 D5: the store process's writer never checkpoints at a commit and
 * checkpoints passively after its writes while the WAL is large.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function database(): { db: DatabaseSync; wal: string } {
  const dir = mkdtempSync(join(tmpdir(), "squeal-writer-checkpoint-"));
  const path = join(dir, "code.sqlite");
  const db = new DatabaseSync(path);
  cleanups.push(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0");
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.exec("CREATE TABLE n (v BLOB NOT NULL)");
  return { db, wal: `${path}-wal` };
}

const blobs = (bytes: number) =>
  Array.from({ length: Math.ceil(bytes / (64 * 1024)) }, () => ({
    sql: "INSERT INTO n (v) VALUES (randomblob(?))",
    params: [64 * 1024],
  }));

/** Frames in the WAL now, after a passive checkpoint of its own. */
function walFrames(db: DatabaseSync): number {
  return Number(db.prepare("PRAGMA wal_checkpoint(PASSIVE)").get()?.log);
}

describe("the store process's writer checkpoints", () => {
  it("passively after a write that leaves the WAL large, at most once a second", () => {
    const { db, wal } = database();
    let clock = 0;
    const writer = new CheckpointingWriter(db, wal, () => clock);
    expect(writer.write("w1", batchSeq(1, 1), blobs(PASSIVE_CHECKPOINT_BYTES))).toEqual({
      end: "written",
    });
    // Checkpointed whole after the write, so the next writer starts the WAL over.
    clock += WRITER_CHECKPOINT_MS - 1;
    writer.write("w1", batchSeq(1, 2), blobs(1));
    expect(walFrames(db)).toBeLessThan(100);

    // Within the second no look: the next write appends to the large WAL.
    writer.write("w1", batchSeq(1, 3), blobs(PASSIVE_CHECKPOINT_BYTES));
    writer.write("w1", batchSeq(1, 4), blobs(1));
    expect(walFrames(db)).toBeGreaterThan(1_000);

    // A second after the last look the writer looks again.
    writer.write("w1", batchSeq(1, 5), blobs(PASSIVE_CHECKPOINT_BYTES));
    clock += 1;
    writer.write("w1", batchSeq(1, 6), blobs(1));
    writer.write("w1", batchSeq(1, 7), blobs(1));
    expect(walFrames(db)).toBeLessThan(100);
  });

  it("turns commit checkpoints off and tunes the writer's connection", () => {
    const commonDir = fakeCommonDir();
    const exec = vi.spyOn(DatabaseSync.prototype, "exec");
    const opened = openWriteConnection(commonDir);
    if (typeof opened === "string") throw new Error(opened);
    try {
      const ran = exec.mock.calls.map(([sql]) => sql);
      expect(ran).toEqual(
        expect.arrayContaining([
          "PRAGMA cache_size = -16384",
          "PRAGMA temp_store = MEMORY",
          "PRAGMA wal_autocheckpoint = 0",
        ]),
      );
      expect(opened.writer).toBeInstanceOf(CheckpointingWriter);
    } finally {
      opened.close();
    }
  });
});
