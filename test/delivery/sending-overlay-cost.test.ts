import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Statement } from "../../src/core/daemon/write-batch.js";
import { SendingConnection, type WriteSender } from "../../src/core/delivery/sending-connection.js";

/** Statements each `overlaidMeta` call is handed: what a read pays for the overlay. */
const scanned = vi.hoisted(() => ({ statements: 0 }));

vi.mock("../../src/core/delivery/sent-meta.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/core/delivery/sent-meta.js")>();
  return {
    ...real,
    overlaidMeta: (...args: Parameters<typeof real.overlaidMeta>) => {
      scanned.statements += args[2].length;
      return real.overlaidMeta(...args);
    },
  };
});

const SET = "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)";
const META = "SELECT value FROM meta WHERE key = ?";
const STATE = "SELECT name FROM state WHERE id = ?";

const sender: WriteSender = {
  leased: true,
  send: async (_batch: readonly Statement[]) => "written",
  release: async () => {},
};

let open: SendingConnection | null = null;

function connection(): SendingConnection {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  db.exec("CREATE TABLE state (id INTEGER PRIMARY KEY, name TEXT)");
  db.exec("INSERT INTO meta (key, value) VALUES ('told', 'stored')");
  db.exec("INSERT INTO state (id, name) VALUES (1, 'a')");
  open = new SendingConnection(db, sender);
  scanned.statements = 0;
  return open;
}

afterEach(() => {
  open?.close();
  open = null;
});

const M = 200;
const N = 50;

describe("row 005-123: the pending overlay of a SendingConnection", () => {
  it("costs a non-meta read nothing, whatever the size of the batch it holds", () => {
    const conn = connection();
    conn.transaction(() => {
      for (let i = 0; i < M; i++) conn.run(SET, `k${i}`, "v");
      for (let j = 0; j < N; j++) expect(conn.get(STATE, 1)).toEqual({ name: "a" });
    });
    // Before the row: M statements for each of the N reads.
    expect(scanned.statements).toBe(0);
  });

  it("costs a non-meta read nothing inside a hold either", () => {
    const conn = connection();
    const held = conn.hold();
    conn.transaction(() => {
      for (let i = 0; i < M; i++) conn.run(SET, `k${i}`, "v");
    });
    conn.transaction(() => {
      for (let i = 0; i < M; i++) conn.run(SET, `j${i}`, "v");
      for (let j = 0; j < N; j++) conn.get(STATE, 1);
    });
    expect(scanned.statements).toBe(0);
    held?.rollback();
  });

  it("still reads a meta key from the held writes, then the open batch", () => {
    const conn = connection();
    const held = conn.hold();
    conn.transaction(() => conn.run(SET, "told", "held"));
    expect(conn.get(META, "told")).toEqual({ value: "held" });
    conn.transaction(() => {
      expect(conn.get(META, "told")).toEqual({ value: "held" });
      conn.run(SET, "told", "open");
      expect(conn.get(META, "told")).toEqual({ value: "open" });
      conn.run("DELETE FROM meta WHERE key = ?", "told");
      expect(conn.get(META, "told")).toBeNull();
      expect(conn.get(META, "other")).toBeNull();
    });
    held?.rollback();
  });

  it("reads a meta key no pending write touched from the store", () => {
    const conn = connection();
    conn.transaction(() => {
      conn.run(SET, "k", "v");
      expect(conn.get(META, "told")).toEqual({ value: "stored" });
    });
  });
});
