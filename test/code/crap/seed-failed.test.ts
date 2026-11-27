import { DatabaseSync } from "node:sqlite";
import { setImmediate as nextTurn, setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { Pace } from "../../../src/core/code/coverage/pace.js";
import { codeStorePath } from "../../../src/core/code/store/open.js";
import type { Statement } from "../../../src/core/daemon/write-batch.js";
import { SendingConnection } from "../../../src/core/delivery/sending-connection.js";
import { blobHash } from "../../../src/core/hash/blob.js";
import { daemonPass } from "../pass/helpers.js";
import { COVERED, coverageRig, sourceOf } from "./rig.js";

/*
 * Review of the rebuild of row 021-36, N2: a coverage seed's batch is
 * written after its step, through the store process. When it fails, the
 * seed's progress goes back with it: the next step seeds those functions
 * again, so their first judgement stays quiet, and a function an edit
 * added meanwhile is still a first-seen fail.
 */

const closers: (() => unknown)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

/**
 * The daemon's code-store connection as a relay's: each batch is written a
 * turn later, through a connection of its own; the first batch that seeds
 * a `pending` state fails busy, unwritten.
 */
function failingFirstSeed(commonDir: string) {
  const writer = new DatabaseSync(codeStorePath(commonDir));
  writer.exec("PRAGMA busy_timeout = 5000");
  closers.push(() => writer.close());
  const failed: Statement[][] = [];
  const write = (batch: readonly Statement[]) => {
    writer.exec("BEGIN IMMEDIATE");
    try {
      for (const { sql, params } of batch) writer.prepare(sql).run(...params);
      writer.exec("COMMIT");
    } catch (error) {
      writer.exec("ROLLBACK");
      throw error;
    }
  };
  const connection = (db: DatabaseSync) =>
    new SendingConnection(db, {
      leased: true,
      send: async () => "not-taken",
      release: async () => {},
      post: async (batch) => {
        await nextTurn();
        if (failed.length === 0 && batch.some((s) => s.params.includes("pending"))) {
          failed.push([...batch]);
          throw Object.assign(new Error("database is locked"), { errcode: 5 });
        }
        write(batch);
      },
      surfaced: () => {},
    });
  return { connection, failed };
}

/**
 * Row 011-430: a pace that never nudges on its own; the test's nudges step the pass. A seed
 * step always asks for a paced next step (its batch is still unwritten), and that timer
 * raced the failed batch's turn: when it fired first, the pass seeded again before `idle`
 * resolved, so the edit no longer came while the seed recovered.
 */
class TestPace extends Pace {
  override after(): void {}
}

/** `hot` (CC 12) counted in `src/a.ts`, its record with no line covered, and a daemon pass whose first seed fails. */
async function rigged() {
  const rig = coverageRig();
  await rig.edit({ "src/a.ts": "hot 12 h\n" });
  /** The record of `src/a.ts` holding `text`, its functions none covered, its run after the edit. */
  const record = (text: string) => {
    const blob = blobHash(Buffer.from(text), "sha1");
    const functions = text.trim().split("\n").length;
    rig.loader("test/a.test.ts", {
      closure: ["src/a.ts"],
      record: [sourceOf("src/a.ts", blob, functions, [])],
      recordedAt: Date.now(),
    });
  };
  record("hot 12 h\n");
  const sending = failingFirstSeed(rig.tree.commonDir);
  const run = daemonPass(rig.tree, {
    policy: () => COVERED,
    now: Date.now,
    codeStore: { connection: sending.connection },
    coverage: {
      main: rig.main,
      closures: () => rig.closures,
      writing: () => false,
      pace: new TestPace(),
    },
  });
  closers.push(() => run.code.close());
  /** Nudges until `src/a.ts`'s functions have `uncovered` states other than `pending`. */
  const judged = async () => {
    const deadline = Date.now() + 10_000;
    for (;;) {
      run.code.nudge();
      await run.code.idle();
      const states = rig.states("uncovered");
      if (states.length > 0 && states.every((s) => !s.includes("pending"))) return states;
      if (Date.now() > deadline) throw new Error(`not judged: ${states.join(", ")}`);
      await sleep(20);
    }
  };
  return { rig, run, sending, record, judged };
}

describe("a coverage seed whose batch failed (review of the rebuild, N2)", {
  timeout: 30_000,
}, () => {
  it("seeds again at the next step: the first judgement stays quiet", async () => {
    const { rig, run, sending, judged } = await rigged();
    run.code.nudge();
    await run.code.idle();
    expect(sending.failed).toHaveLength(1);
    expect(run.errors.map((e) => e.message)).toContain("database is locked");

    expect(await judged()).toEqual(["hot fail -"]);
    expect(rig.states("crap")).toEqual(["hot fail 156"]);
    expect(rig.transitions("src/a.ts", ["hot"])).toEqual([]);
  });

  it("keeps a function an edit added while the seed recovers a first-seen fail", async () => {
    const { rig, run, sending, record, judged } = await rigged();
    run.code.nudge();
    await run.code.idle();
    expect(sending.failed).toHaveLength(1);

    // Nothing seeded yet: the edit comes while the seed recovers.
    expect(rig.states("uncovered")).toEqual([]);

    // The edit's pass counts `fresh`; the seed, begun before it, does not hold it. Its run's
    // record is stored with it, so the step after the edit judges both.
    const edited = "hot 12 h\nfresh 15 f\n";
    rig.tree.write("src/a.ts", edited);
    rig.tree.revise();
    record(edited);

    expect(await judged()).toEqual(["fresh fail -", "hot fail -"]);
    expect(rig.transitions("src/a.ts", ["hot"])).toEqual([]);
    expect(rig.transitions("src/a.ts", ["fresh"])).toEqual([
      "crap first-seen-fail fresh",
      "uncovered first-seen-fail fresh",
    ]);
  });
});
