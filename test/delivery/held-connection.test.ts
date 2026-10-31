import { describe, expect, it } from "vitest";
import { HoldingConnection, holdFree } from "../../src/core/delivery/held-connection.js";
import { isBusy } from "../../src/core/store/connection.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { Store } from "../../src/core/types/index.js";
import { fakeCommonDir, open } from "../store/helpers.js";

/** A store on a `HoldingConnection` at `commonDir`, and that connection. */
function holding(commonDir: string, busyTimeoutMs = 10_000) {
  let conn: HoldingConnection | null = null;
  const store = openStore(commonDir, {
    busyTimeoutMs,
    connection: (db) => {
      conn = new HoldingConnection(db);
      return conn;
    },
  });
  if (isStoreOpenFailure(store) || conn === null) throw new Error("open failed");
  return { store: store as Store, conn: conn as HoldingConnection };
}

/** A store whose connection is a `HoldingConnection` (row 011-288), and a plain one beside it. */
function stores(busyTimeoutMs = 10_000) {
  const commonDir = fakeCommonDir();
  const plain = open(commonDir);
  let conn: HoldingConnection | null = null;
  const holding = openStore(commonDir, {
    busyTimeoutMs,
    connection: (db) => {
      conn = new HoldingConnection(db);
      return conn;
    },
  });
  if (isStoreOpenFailure(holding) || conn === null) throw new Error("open failed");
  return { plain, holding: holding as Store, conn: conn as HoldingConnection };
}

const value = (store: Store, key: string) => store.meta.get(key);

describe("HoldingConnection (row 011-288)", () => {
  it("is the connection openStore gives the store when asked", () => {
    const { holding, conn } = stores();
    expect(connectionOf(holding)).toBe(conn);
    holding.close();
  });

  it("commits what a hold wrote only at commit, and nothing at rollback", () => {
    const { plain, holding, conn } = stores();
    const first = conn.hold();
    holding.transaction(() => holding.meta.set("k", "held"));
    expect(conn.held).toBe(true);
    expect(value(plain, "k")).toBeNull();
    first?.commit();
    expect(value(plain, "k")).toBe("held");
    const second = conn.hold();
    holding.meta.set("k", "rolled back");
    second?.rollback();
    expect(conn.held).toBe(false);
    expect(value(plain, "k")).toBe("held");
    holding.close();
  });

  it("makes each transaction in a hold a savepoint, and runs a read inside it", () => {
    const { plain, holding, conn } = stores();
    const held = conn.hold();
    holding.transaction(() => holding.meta.set("a", "1"));
    expect(() =>
      holding.transaction(() => {
        holding.meta.set("b", "2");
        throw new Error("inner");
      }),
    ).toThrow("inner");
    expect(conn.read(() => value(holding, "a"))).toBe("1");
    held?.commit();
    expect(value(plain, "a")).toBe("1");
    expect(value(plain, "b")).toBeNull();
    holding.close();
  });

  it("starts no hold inside another transaction or hold", () => {
    const { holding, conn } = stores();
    expect(holding.transaction(() => conn.hold())).toBeNull();
    const held = conn.hold();
    expect(conn.hold()).toBeNull();
    held?.rollback();
    held?.commit();
    expect(conn.held).toBe(false);
    expect(conn.hold()).not.toBeNull();
    holding.close();
  });

  it("leaves nothing written and the lock free when closed while held", () => {
    const { plain, holding, conn } = stores();
    conn.hold();
    holding.meta.set("k", "lost");
    holding.close();
    plain.transaction(() => plain.meta.set("after", "free"));
    expect(value(plain, "k")).toBeNull();
    expect(value(plain, "after")).toBe("free");
  });

  it("holds the write lock, so another connection's write waits for it", () => {
    const { plain, holding, conn } = stores();
    const held = conn.hold();
    connectionOf(plain).db.exec("PRAGMA busy_timeout = 0");
    expect(() => plain.transaction(() => plain.meta.set("x", "1"))).toThrow(/locked|busy/i);
    held?.rollback();
    plain.transaction(() => plain.meta.set("x", "1"));
    expect(value(plain, "x")).toBe("1");
    holding.close();
  });

  it("lets another connection of this thread wait for a hold, and fails its writes at once", async () => {
    const commonDir = fakeCommonDir();
    const a = holding(commonDir);
    const b = holding(commonDir);
    const held = a.conn.hold();
    expect(holdFree(a.conn, 1_000)).toBeNull();
    const wait = holdFree(b.conn, 5_000);
    expect(wait).not.toBeNull();
    const started = performance.now();
    let error: unknown = null;
    try {
      b.store.transaction(() => b.store.meta.set("k", "b"));
    } catch (thrown) {
      error = thrown;
    }
    // Busy at once: no wait on a lock its own thread holds.
    expect(isBusy(error)).toBe(true);
    expect(performance.now() - started).toBeLessThan(500);
    expect(() => b.conn.hold()).toThrow(/locked/);
    expect(() => b.store.meta.set("k", "b")).toThrow(/locked/);
    held?.commit();
    await wait;
    expect(holdFree(b.conn, 1_000)).toBeNull();
    b.store.transaction(() => b.store.meta.set("k", "b"));
    expect(b.store.meta.get("k")).toBe("b");
    a.store.close();
    b.store.close();
  });

  it("ends the wait at its bound while the hold stays open", async () => {
    const commonDir = fakeCommonDir();
    const a = holding(commonDir);
    const b = holding(commonDir);
    const held = a.conn.hold();
    const started = performance.now();
    await holdFree(b.conn, 100);
    expect(performance.now() - started).toBeGreaterThanOrEqual(95);
    held?.rollback();
    a.store.close();
    b.store.close();
  });

  it("no longer holds the database for this thread once closed while held", () => {
    const commonDir = fakeCommonDir();
    const a = holding(commonDir);
    const b = holding(commonDir);
    a.conn.hold();
    a.store.meta.set("k", "lost");
    a.store.close();
    expect(holdFree(b.conn, 1_000)).toBeNull();
    b.store.transaction(() => b.store.meta.set("after", "free"));
    expect(b.store.meta.get("k")).toBeNull();
    expect(b.store.meta.get("after")).toBe("free");
    b.store.close();
  });
});
