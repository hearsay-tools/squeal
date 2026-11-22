import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { Statement } from "../../src/core/daemon/write-batch.js";
import { createDelivery } from "../../src/core/delivery/delivery.js";
import { PreparedReports } from "../../src/core/delivery/prepared.js";
import { SendingConnection, type WriteSender } from "../../src/core/delivery/sending-connection.js";
import { createStateSink } from "../../src/core/state/sink.js";
import type { Consumer } from "../../src/core/types/delivery.js";
import { check, result, setKey, WT } from "../state/helpers.js";
import { fakeCommonDir, open } from "../store/helpers.js";
import { fixedStatus } from "./fakes.js";
import { sentStore } from "./sent-fixture.js";

/*
 * Spec 024 D2 (row 024-02): a `SendingConnection.unit` whose work returns without awaiting,
 * and whose last write is a transaction outside a hold, sends that batch with the lease's
 * release: one request where there were a write and a release. Work that awaits, a hold (row
 * 011-288), and work that throws keep the requests they made before.
 */

const SET = "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)";
const META = "SELECT value FROM meta WHERE key = ?";

interface Fake {
  readonly connection: SendingConnection;
  readonly log: string[];
  readonly acquire: () => Promise<boolean>;
  /** The rows the daemon wrote. */
  readonly written: () => unknown[];
}

let opened: SendingConnection | null = null;

afterEach(() => {
  opened?.close();
  opened = null;
});

function fake(): Fake {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  const daemon: Statement[] = [];
  const log: string[] = [];
  const sender: WriteSender & { leased: boolean } = {
    leased: false,
    send: async (batch, release) => {
      log.push(release ? "write+release" : "write");
      daemon.push(...batch);
      if (release) sender.leased = false;
      return "written";
    },
    release: async () => {
      log.push("release");
      sender.leased = false;
    },
  };
  const acquire = async () => {
    log.push("lease");
    sender.leased = true;
    return true;
  };
  const connection = new SendingConnection(db, sender);
  opened = connection;
  return { connection, log, acquire, written: () => daemon.map((s) => s.params) };
}

describe("a unit whose last write is a plain transaction (spec 024 D2)", () => {
  it("sends it with the release in one request when the work returns without awaiting", async () => {
    const { connection: c, log, acquire, written } = fake();
    await c.unit(() => c.transaction(() => c.run(SET, "k", "v")), acquire);
    expect(log).toEqual(["lease", "write+release"]);
    expect(written()).toEqual([["k", "v"]]);
  });

  it("sends a write and then a release when the work awaits after it", async () => {
    const { connection: c, log, acquire } = fake();
    await c.unit(async () => {
      c.transaction(() => c.run(SET, "k", "v"));
      await c.sent();
      expect(log).toEqual(["lease", "write"]);
      c.transaction(() => c.run(SET, "k2", "v"));
    }, acquire);
    expect(log).toEqual(["lease", "write", "write", "release"]);
  });

  it("sends the batch ended before the first await at that await, unreleased", async () => {
    const { connection: c, log, acquire } = fake();
    await c.unit(async () => {
      c.transaction(() => c.run(SET, "k", "v"));
      await Promise.resolve();
      expect(log).toEqual(["lease", "write"]);
    }, acquire);
    expect(log).toEqual(["lease", "write", "release"]);
  });

  it("still refuses a read before the batch is written, as before", async () => {
    const { connection: c, acquire } = fake();
    await expect(
      c.unit(() => {
        c.transaction(() => c.run(SET, "k", "v"));
        return c.get(META, "k");
      }, acquire),
    ).rejects.toThrow(/before this hook's writes were written/);
  });

  it("writes the batch of work that throws after it, then releases", async () => {
    const { connection: c, log, acquire, written } = fake();
    await expect(
      c.unit(() => {
        c.transaction(() => c.run(SET, "k", "v"));
        throw new Error("after the write");
      }, acquire),
    ).rejects.toThrow("after the write");
    expect(log).toEqual(["lease", "write", "release"]);
    expect(written()).toEqual([["k", "v"]]);
  });

  it("takes no lease and sends nothing for work that only reads", async () => {
    const { connection: c, log, acquire } = fake();
    await c.unit(() => c.read(() => c.get(META, "k")), acquire);
    expect(log).toEqual([]);
  });

  it("releases after an empty transaction, which sends no batch", async () => {
    const { connection: c, log, acquire } = fake();
    await c.unit(() => c.transaction(() => c.get(META, "k")), acquire);
    expect(log).toEqual(["lease", "release"]);
  });

  it("ends the lease of a unit inside another's awaited work with its write, as its settle did", async () => {
    const { connection: c, log, acquire } = fake();
    await c.unit(async () => {
      await c.unit(() => c.transaction(() => c.run(SET, "k", "v")), acquire);
      expect(log).toEqual(["lease", "write+release"]);
    }, acquire);
    expect(log).toEqual(["lease", "write+release"]);
  });

  it("does not release in a unit inside another's synchronous work, whose settle releases", async () => {
    const { connection: c, log, acquire } = fake();
    await acquire();
    log.length = 0;
    let inner: Promise<unknown> = Promise.resolve();
    await c.unit(() => {
      inner = c.unit(() => c.transaction(() => c.run(SET, "k", "v")), acquire);
    }, acquire);
    await inner;
    expect(log).toEqual(["write", "release"]);
  });
});

describe("a hold keeps its batches until its verdict (row 011-288)", () => {
  it("sends nothing before the commit, then the held batches with the release", async () => {
    const { connection: c, log, acquire, written } = fake();
    let held: ReturnType<SendingConnection["hold"]> = null;
    await c.unit(() => {
      held = c.hold();
      c.transaction(() => c.run(SET, "k", "v"));
    }, acquire);
    expect(log).toEqual(["lease"]);
    expect(written()).toEqual([]);
    (held as ReturnType<SendingConnection["hold"]>)?.commit();
    await c.sent();
    expect(log).toEqual(["lease", "write+release"]);
    expect(written()).toEqual([["k", "v"]]);
  });

  it("drops the held batches at the rollback and ends the lease", async () => {
    const { connection: c, log, acquire, written } = fake();
    let held: ReturnType<SendingConnection["hold"]> = null;
    await c.unit(() => {
      held = c.hold();
      c.transaction(() => c.run(SET, "k", "v"));
    }, acquire);
    (held as ReturnType<SendingConnection["hold"]>)?.rollback();
    await c.sent();
    expect(log).toEqual(["lease", "release"]);
    expect(written()).toEqual([]);
  });

  it("a hold committed in a unit's synchronous work sends one write with the release", async () => {
    const { connection: c, log, acquire } = fake();
    await c.unit(() => {
      const held = c.hold();
      c.transaction(() => c.run(SET, "k", "v"));
      held?.commit();
    }, acquire);
    expect(log).toEqual(["lease", "write+release"]);
  });
});

describe("a hook's delivery while a daemon serves (spec 024 D2)", () => {
  const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };

  async function served() {
    const commonDir = fakeCommonDir();
    const setup = open(commonDir);
    setKey(setup, "k1");
    createStateSink(setup, { now: () => 1_000 }).applyResults(WT, 1, [result(check("a"), "pass")], {
      checkpointId: null,
    });
    await createDelivery(setup, { status: fixedStatus(), now: () => 1_000 }).register(C1);
    const sent = sentStore(commonDir);
    const reports = new PreparedReports();
    const delivery = createDelivery(sent.store, {
      status: fixedStatus(),
      now: () => 2_000,
      prepare: { connection: sent.connection, reports, unit: sent.write },
    });
    return { sent, delivery, setup };
  }

  it("ends a turn (Stop) with one write that ends the lease", async () => {
    const { sent, delivery } = await served();
    expect(await delivery.endTurn(C1)).toBe(true);
    expect(sent.log).toEqual(["lease", "write+release"]);
    sent.close();
  });

  it("unregisters with one write that ends the lease", async () => {
    const { sent, delivery, setup } = await served();
    await delivery.unregister(C1);
    expect(sent.log).toEqual(["lease", "write+release"]);
    expect(setup.consumers.get(C1)).toBeNull();
    sent.close();
  });

  it("keeps a silent boundary at one write that ends the lease", async () => {
    const { sent, delivery, setup } = await served();
    expect(await delivery.onToolBoundary(C1)).toBeNull();
    expect(sent.log).toEqual(["lease", "write+release"]);
    expect(setup.consumers.get(C1)?.lastSeenAt).toBe(2_000);
    sent.close();
  });
});
