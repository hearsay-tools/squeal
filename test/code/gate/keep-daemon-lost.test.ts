import { rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import {
  A,
  B,
  BOTH,
  countGateWrites,
  type Inputs,
  KEY_A,
  KEY_B,
  kept,
  type ProxiedRequest,
  type ProxyPlan,
  RECORD,
  realInputs,
  recordAt,
  resultsAt,
  type Served,
  served,
} from "./keep-daemon-kit.js";

/*
 * Row 021-20, review 0.1.450 B2: a keep try whose answer is lost on the
 * way back is asked again by the gate's own id; the daemon runs one id
 * once, so the gate never writes twice, and a write that landed is told as
 * kept. A try the daemon never received is tried anew; one the daemon took
 * and never told of within the bound is told as perhaps kept, not as not
 * kept. A proxy between the gate and the daemon's socket holds or drops one
 * answer; no store or timeout is faked beyond the gate's shorter waits.
 */

const SLOW = { timeout: 60_000 } as const;
/** The gate's waits, short so a held answer outlasts one: 300 ms per answer, 1.5 s to ask again. */
const WAITS = { answerMs: 300, reconcileMs: 1_500 } as const;
/** An answer held past one wait. */
const HELD = { answerAfterMs: 700 } as const;

/** The first request `is` picks gets `first`; every other request passes. */
function once(is: (request: ProxiedRequest) => boolean, first: ReturnType<ProxyPlan>): ProxyPlan {
  let used = false;
  return (request) => {
    if (used || !is(request)) return "forward";
    used = true;
    return first;
  };
}

const keepOf = (kind: string) => (request: ProxiedRequest) =>
  request.type === "keep" && request.write?.kind === kind;

const runs = (at: Served, kind: string) => at.keeps.filter((k) => k.write.kind === kind).length;

describe("a keep whose answer is lost (review 0.1.450 B2)", () => {
  it("asks again for a results write whose answer was held, and runs it once", SLOW, async () => {
    const at = await served({ proxy: once(keepOf("results"), HELD) });
    const notes: string[] = [];
    const count = countGateWrites();
    await kept(at, notes, { daemonWaits: WAITS });
    expect(count.stop()).toBe(0);
    expect(notes).toEqual([]);
    expect([runs(at, "coverage"), runs(at, "results")]).toEqual([1, 1]);
    expect(resultsAt(at.commonDir)).toBe(1);
    expect(recordAt(at.commonDir)).toEqual(RECORD);
  });

  it("goes on to the results after a coverage write whose answer was held", SLOW, async () => {
    const at = await served({ proxy: once(keepOf("coverage"), HELD) });
    const notes: string[] = [];
    await kept(at, notes, { daemonWaits: WAITS });
    expect(notes).toEqual([]);
    expect([runs(at, "coverage"), runs(at, "results")]).toEqual([1, 1]);
    expect(resultsAt(at.commonDir)).toBe(1);
    expect(recordAt(at.commonDir)).toEqual(RECORD);
  });

  it("asks again when a status answer was held", SLOW, async () => {
    // The daemon is slow to start each write, so the first answer has no outcome yet.
    const at = await served({
      proxy: once((request) => request.type === "keep-status", HELD),
      beforeKeep: () => sleep(100),
    });
    const notes: string[] = [];
    await kept(at, notes, { daemonWaits: WAITS });
    expect(notes).toEqual([]);
    expect([runs(at, "coverage"), runs(at, "results")]).toEqual([1, 1]);
    expect(resultsAt(at.commonDir)).toBe(1);
  });

  it("tries anew a write the daemon never received", SLOW, async () => {
    const at = await served({ proxy: once(keepOf("results"), "drop") });
    const notes: string[] = [];
    await kept(at, notes, { daemonWaits: WAITS });
    expect(notes).toEqual([]);
    expect([runs(at, "coverage"), runs(at, "results")]).toEqual([1, 1]);
    expect(resultsAt(at.commonDir)).toBe(1);
  });

  it(
    "says the file may be kept when the daemon took the write and stopped answering",
    SLOW,
    async () => {
      let taken = false;
      const at = await served({
        proxy: (request) => {
          if (keepOf("results")(request) && !taken) {
            taken = true;
            return { answerAfterMs: 30_000 };
          }
          return taken ? "drop" : "forward";
        },
      });
      const notes: string[] = [];
      await kept(at, notes, { daemonWaits: WAITS });
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatch(
        /^1 completed test file may not be kept in the stores: whether the daemon kept it is not known \(the daemon took the write and did not say how it went: .+\); the next run reads it if it was kept, else runs it again$/,
      );
      expect(runs(at, "results")).toBe(1);
      // The daemon wrote it: the next run reads it.
      expect(resultsAt(at.commonDir)).toBe(1);
    },
  );

  it("says the file was not kept when the request never reached a daemon", async () => {
    const at = await served();
    // The socket file is gone: a connect fails before anything is sent.
    rmSync(at.socketPath);
    const notes: string[] = [];
    await kept(at, notes, { daemonWaits: WAITS });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(
      /^1 completed test file was not kept in the stores: the daemon did not answer: /,
    );
    expect(at.keeps).toEqual([]);
  });
});

describe("an input that moves while a try is lost (review 0.1.450 R1-B2)", () => {
  /**
   * A worktree with real inputs whose daemon never receives the first
   * request `is` picks: the proxy rewrites `moved`'s input, then drops the
   * request.
   */
  async function lostWhileMoving(is: (request: ProxiedRequest) => boolean, moved: TestFileRef) {
    let inputs: Inputs | null = null;
    let dropped = false;
    const at = await served({
      proxy: (request) => {
        if (dropped || !is(request)) return "forward";
        dropped = true;
        inputs?.move(moved);
        return "drop";
      },
    });
    inputs = await realInputs(at.root);
    return { at, inputs, dropped: () => dropped };
  }

  const NOT_KEPT =
    "1 completed test file was not kept in the stores: it changed after a write the daemon never received; the next run will run it again";

  it(
    "does not write the results of a file whose input moved while its results request was lost",
    SLOW,
    async () => {
      const { at, inputs, dropped } = await lostWhileMoving(keepOf("results"), A);
      const notes: string[] = [];
      const count = countGateWrites();
      await kept(at, notes, { daemonWaits: WAITS, inputs });
      expect(count.stop()).toBe(0);
      expect(dropped()).toBe(true);
      expect(notes).toEqual([NOT_KEPT]);
      expect([runs(at, "coverage"), runs(at, "results")]).toEqual([1, 0]);
      expect(resultsAt(at.commonDir)).toBe(0);
    },
  );

  it(
    "writes nothing of a file whose input moved while its coverage request was lost",
    SLOW,
    async () => {
      const { at, inputs, dropped } = await lostWhileMoving(keepOf("coverage"), A);
      const notes: string[] = [];
      await kept(at, notes, { daemonWaits: WAITS, inputs });
      expect(dropped()).toBe(true);
      expect(notes).toEqual([NOT_KEPT]);
      expect([runs(at, "coverage"), runs(at, "results")]).toEqual([0, 0]);
      expect(recordAt(at.commonDir)).toBeNull();
      expect(resultsAt(at.commonDir)).toBe(0);
    },
  );

  it(
    "checks the next file too after a recovery pause, and writes the lost file once",
    SLOW,
    async () => {
      // A's results request is lost while B's input moves: A is sent again and kept, B is not written.
      const { at, inputs } = await lostWhileMoving(keepOf("results"), B);
      const notes: string[] = [];
      await kept(at, notes, { daemonWaits: WAITS, inputs, files: BOTH });
      expect(notes).toEqual([NOT_KEPT]);
      expect(at.keeps.map((k) => [k.write.kind, k.write.key])).toEqual([
        ["coverage", KEY_A],
        ["results", KEY_A],
      ]);
      expect([resultsAt(at.commonDir, KEY_A), resultsAt(at.commonDir, KEY_B)]).toEqual([1, 0]);
      expect(recordAt(at.commonDir, KEY_B)).toBeNull();
    },
  );
});
