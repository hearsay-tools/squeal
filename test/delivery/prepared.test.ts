import { describe, expect, it } from "vitest";
import { HoldingConnection } from "../../src/core/delivery/held-connection.js";
import { PreparedReports, startHold } from "../../src/core/delivery/prepared.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import type { Store } from "../../src/core/types/index.js";
import { fakeCommonDir, open } from "../store/helpers.js";

/*
 * Row 011-288: a delivery's hold, opened before its transaction. A report
 * commits with its code-store writes and its lint acknowledgement; a silent
 * delivery commits at once; an abandoned one leaves nothing.
 */

function setup() {
  const commonDir = fakeCommonDir();
  const plain = open(commonDir);
  let connection: HoldingConnection | null = null;
  const store = openStore(commonDir, {
    busyTimeoutMs: 10_000,
    connection: (db) => {
      connection = new HoldingConnection(db);
      return connection;
    },
  });
  if (isStoreOpenFailure(store) || connection === null) throw new Error("open failed");
  const prepare = { connection: connection as HoldingConnection, reports: new PreparedReports() };
  return { plain, store: store as Store, prepare };
}

/** A code-store hold that records its end. */
function codeHold(ends: string[], name: string) {
  return {
    commit: () => ends.push(`${name} commit`),
    rollback: () => ends.push(`${name} rollback`),
  };
}

describe("startHold (row 011-288)", () => {
  it("commits a report, then its code-store writes, then its acknowledgement, at the verdict", () => {
    const { plain, store, prepare } = setup();
    const ends: string[] = [];
    const hold = startHold(prepare);
    store.transaction(() => store.meta.set("view", "fail"));
    hold.code?.push(codeHold(ends, "code"));
    expect(hold.settle("report", () => ends.push("ack"))).toBe("report");
    expect(prepare.reports.pending).toBe(true);
    expect(plain.meta.get("view")).toBeNull();
    prepare.reports.commit();
    expect(plain.meta.get("view")).toBe("fail");
    expect(ends).toEqual(["code commit", "ack"]);
    expect(prepare.reports.pending).toBe(false);
    store.close();
  });

  it("commits a delivery that tells nothing at once", () => {
    const { plain, store, prepare } = setup();
    const ends: string[] = [];
    const hold = startHold(prepare);
    store.transaction(() => store.meta.set("seen", "1"));
    expect(hold.settle(null, () => ends.push("ack"))).toBeNull();
    expect(plain.meta.get("seen")).toBe("1");
    expect(ends).toEqual(["ack"]);
    expect(prepare.reports.pending).toBe(false);
    store.close();
  });

  it("leaves nothing of an abandoned report", () => {
    const { plain, store, prepare } = setup();
    const ends: string[] = [];
    const hold = startHold(prepare);
    store.transaction(() => store.meta.set("view", "fail"));
    hold.code?.push(codeHold(ends, "code"));
    hold.settle("report", () => ends.push("ack"));
    prepare.reports.abandon();
    expect(plain.meta.get("view")).toBeNull();
    expect(ends).toEqual(["code rollback"]);
    prepare.reports.commit();
    expect(ends).toEqual(["code rollback"]);
    store.close();
  });

  it("keeps, from a delivery that threw, only what was written after it", () => {
    const { plain, store, prepare } = setup();
    const ends: string[] = [];
    const hold = startHold(prepare);
    expect(() =>
      store.transaction(() => {
        store.meta.set("view", "fail");
        hold.code?.push(codeHold(ends, "code"));
        throw new Error("delivery failed");
      }),
    ).toThrow("delivery failed");
    store.transaction(() => store.meta.set("after", "1"));
    prepare.reports.commit();
    expect(plain.meta.get("view")).toBeNull();
    expect(plain.meta.get("after")).toBe("1");
    expect(ends).toEqual(["code rollback"]);
    store.close();
  });

  it("holds nothing without `prepare`, and acknowledges at once", () => {
    const ends: string[] = [];
    const hold = startHold(undefined);
    expect(hold.code).toBeUndefined();
    expect(hold.settle("report", () => ends.push("ack"))).toBe("report");
    expect(ends).toEqual(["ack"]);
  });

  it("inside a hold already open, leaves its code-store writes and acknowledgement to that hold's verdict", () => {
    const { plain, store, prepare } = setup();
    const ends: string[] = [];
    const outer = startHold(prepare);
    store.transaction(() => store.meta.set("first", "1"));
    outer.settle("first", () => ends.push("first ack"));
    const inner = startHold(prepare);
    store.transaction(() => store.meta.set("second", "1"));
    inner.code?.push(codeHold(ends, "second code"));
    inner.settle(null, () => ends.push("second ack"));
    expect(ends).toEqual([]);
    prepare.reports.commit();
    expect(plain.meta.get("second")).toBe("1");
    expect(ends).toEqual(["first ack", "second code commit", "second ack"]);
    store.close();
  });
});
