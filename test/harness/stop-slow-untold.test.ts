import { describe, expect, it } from "vitest";
import { startTurn } from "../../src/core/delivery/turn.js";
import { refinedMetaKey } from "../../src/core/types/index.js";
import type { SquealRepo } from "./helpers.js";
import {
  clock,
  HARNESSES,
  type Harness,
  landSlow,
  mainConsumer,
  queueSlowAgain,
  repo,
  SLOW_FILE,
  slowKey,
  stopThenWait,
  turnOf,
} from "./stop-slow-helpers.js";

/*
 * Task 001-305 (the human, after review wave 13ap): when the waiting Stop
 * decides, it blocks once if any slow check is a current failure the
 * session was not told, whatever revision or key it ran at. Every schedule
 * of reviews 13an (B1, S2) and 13ap (B1) is here: a slow file listed late,
 * moved to a newer key, or both, its runs landing before the entry's first
 * read or during it (`clock`). Each failure blocks; each pass is silent.
 */

/** The slow file not listed yet, and the runner part of revision 1 that lists it unfinished. */
async function unlisted(harness: Harness): Promise<SquealRepo> {
  const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
  r.store.testFileKeys.remove(r.worktreeId, [SLOW_FILE]);
  r.store.meta.set(refinedMetaKey(r.worktreeId), "0");
  return r;
}

/** The runner part lists and queues the slow file, its run lands, and refinement ends at `refined`. */
function listAndLand(r: SquealRepo, outcome: "pass" | "fail", refined = "1"): void {
  r.store.transaction(() => {
    slowKey(r, "queued");
    landSlow(r, outcome);
    r.store.meta.set(refinedMetaKey(r.worktreeId), refined);
  });
}

/** Revision 2 moves the slow file to `slow2`, its run there lands, and refinement ends. */
function moveAndLand(r: SquealRepo, outcome: "pass" | "fail"): void {
  queueSlowAgain(r);
  landSlow(r, outcome, "slow2");
  r.store.meta.set(refinedMetaKey(r.worktreeId), "2");
}

const FAILS_AT = (revision: number) =>
  new RegExp(
    `ran at revision ${revision}: 1 check fails: test/e2e/slow.test.ts > ledger > posts\\.`,
  );

// Each test runs both Stop entries in process, the waiting one polling a real
// store: past the 5 s default under a loaded full suite (task 001-320).
describe.each(HARNESSES)(
  "the waiting Stop blocks on a slow failure not told, $name",
  (harness) => {
    for (const when of ["before", "during"] as const) {
      /** `first` after the 2 s entry; `act` then too, or at the waiting entry's first poll. */
      const run = (r: SquealRepo, act: () => void, first = () => {}) =>
        when === "before"
          ? stopThenWait(harness, r, () => {
              first();
              act();
            })
          : stopThenWait(harness, r, first, clock({ 2: act }));

      it(`13an B1: a slow file listed and failed ${when} its first read blocks`, async () => {
        const r = await unlisted(harness);
        const out = await run(r, () => listAndLand(r, "fail"));
        expect(out.quick).toEqual({});
        expect(out.waiting.decision).toBe("block");
        expect(out.waiting.reason).toMatch(FAILS_AT(1));
        expect(turnOf(r)).toBe("in-turn");
      });

      it(`13an B1 control: a slow file listed and passed ${when} its first read is silent`, async () => {
        const r = await unlisted(harness);
        const out = await run(r, () => listAndLand(r, "pass"));
        expect(out).toEqual({ quick: {}, waiting: {} });
        expect(turnOf(r)).toBe("idle");
      });

      it(`13an S2: a pending file moved and failed at a newer key ${when} its first read blocks`, async () => {
        const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
        const out = await run(r, () => moveAndLand(r, "fail"));
        expect(out.quick).toEqual({});
        expect(out.waiting.decision).toBe("block");
        expect(out.waiting.reason).toMatch(FAILS_AT(2));
        expect(turnOf(r)).toBe("in-turn");
      });

      it(`13an S2 control: a pending file moved and passed ${when} its first read is silent`, async () => {
        const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
        const out = await run(r, () => moveAndLand(r, "pass"));
        expect(out).toEqual({ quick: {}, waiting: {} });
        expect(turnOf(r)).toBe("idle");
      });

      it(`13ap B1: a file listed late, failed, then moved and failed again ${when} its first read blocks`, async () => {
        const r = await unlisted(harness);
        const out = await run(
          r,
          () => moveAndLand(r, "fail"),
          () => listAndLand(r, "fail", "0"),
        );
        expect(out.quick).toEqual({});
        expect(out.waiting.decision).toBe("block");
        expect(out.waiting.reason).toMatch(FAILS_AT(2));
        expect(turnOf(r)).toBe("in-turn");
      });

      it(`13ap B1 control: the same file passing at the newer key ${when} its first read is silent`, async () => {
        const r = await unlisted(harness);
        const out = await run(
          r,
          () => moveAndLand(r, "pass"),
          () => listAndLand(r, "fail", "0"),
        );
        expect(out).toEqual({ quick: {}, waiting: {} });
        expect(turnOf(r)).toBe("idle");
      });
    }

    it("13ap B1: the late file failed during the first read, moved and failed during the next, blocks", async () => {
      const r = await unlisted(harness);
      const at = clock({ 2: () => listAndLand(r, "fail", "0"), 3: () => moveAndLand(r, "fail") });
      const out = await stopThenWait(harness, r, () => {}, at);
      expect(out.waiting.decision).toBe("block");
      expect(out.waiting.reason).toMatch(FAILS_AT(2));
      expect(turnOf(r)).toBe("in-turn");
    });

    for (const outcome of ["fail", "pass"] as const) {
      it(`13ap B1 control: the late file seen queued, then moved and ${outcome}ed, decides it`, async () => {
        const r = await unlisted(harness);
        const queued = () => slowKey(r, "queued");
        const at = clock({ 2: () => moveAndLand(r, outcome) });
        const out = await stopThenWait(harness, r, queued, at);
        if (outcome === "pass") expect(out).toEqual({ quick: {}, waiting: {} });
        else expect(out.waiting.reason).toMatch(FAILS_AT(2));
        expect(turnOf(r)).toBe(outcome === "pass" ? "idle" : "in-turn");
      });
    }

    it("13an S2: a pending file moved and failed between two polls blocks once", async () => {
      const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 2_000 });
      const owed = () => {
        landSlow(r, "pass");
        r.store.meta.set(refinedMetaKey(r.worktreeId), "0");
      };
      const out = await stopThenWait(harness, r, owed, clock({ 3: () => moveAndLand(r, "fail") }));
      expect(out.waiting.decision).toBe("block");
      expect(out.waiting.reason).toMatch(FAILS_AT(2));
      expect(turnOf(r)).toBe("in-turn");
    });

    it("a slow failure the agent did not cause and was not told blocks once", async () => {
      const r = await unlisted(harness);
      const out = await stopThenWait(harness, r, () => {
        r.apply();
        listAndLand(r, "fail", "2");
      });
      expect(out.waiting.decision).toBe("block");
      expect(out.waiting.reason).toMatch(FAILS_AT(2));
      expect(turnOf(r)).toBe("in-turn");
      // The block told it: the next Stop's two entries say nothing more about it.
      expect(await stopThenWait(harness, r)).toEqual({ quick: {}, waiting: {} });
      expect(turnOf(r)).toBe("idle");
    });

    it("a slow failure told before the turn ended does not block", async () => {
      const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
      landSlow(r, "fail");
      await harness.startTurn(r);
      r.store.meta.set(refinedMetaKey(r.worktreeId), "0");
      const out = await stopThenWait(harness, r, () =>
        r.store.meta.set(refinedMetaKey(r.worktreeId), "1"),
      );
      expect(out).toEqual({ quick: {}, waiting: {} });
      expect(turnOf(r)).toBe("idle");
    });

    it("a told slow failure failing the same way at a newer key does not block", async () => {
      const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
      landSlow(r, "fail");
      await harness.startTurn(r);
      const out = await stopThenWait(harness, r, () => moveAndLand(r, "fail"));
      expect(out).toEqual({ quick: {}, waiting: {} });
      expect(turnOf(r)).toBe("idle");
    });

    // Task 011-14, review wave 1.12 re-review R2: the view an older daemon's rules wrote is read under the current ones.
    it("a told slow failure whose view holds the older rules' form does not block, this turn or the next", async () => {
      const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
      landSlow(r, "fail", "slow1", "listen 127.0.0.1:35321");
      await harness.startTurn(r);
      const consumer = mainConsumer(r);
      const views = r.store.views.list(consumer);
      const old = views.map((v) => ({
        ...v,
        fingerprint: v.fingerprint?.replace("<port>", "35321") ?? null,
      }));
      r.store.transaction(() => r.store.views.writeMany(consumer, old));
      expect(r.store.views.list(consumer).some((v) => v.fingerprint?.includes(":35321"))).toBe(
        true,
      );
      expect(await stopThenWait(harness, r)).toEqual({ quick: {}, waiting: {} });
      startTurn(r.store, consumer);
      expect(await stopThenWait(harness, r)).toEqual({ quick: {}, waiting: {} });
    });

    it("a told slow failure that now fails differently blocks", async () => {
      const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
      landSlow(r, "fail");
      await harness.startTurn(r);
      const out = await stopThenWait(harness, r, () => {
        queueSlowAgain(r);
        landSlow(r, "fail", "slow2", "ledger total drifted");
        r.store.meta.set(refinedMetaKey(r.worktreeId), "2");
      });
      expect(out.waiting.decision).toBe("block");
      expect(out.waiting.reason).toContain("ledger total drifted");
      expect(turnOf(r)).toBe("in-turn");
    });
  },
  30_000,
);
