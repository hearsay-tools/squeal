import { describe, expect, it, onTestFinished, vi } from "vitest";
import { DISCHARGE_CAP, HOLD_MS, INCOMPLETE_ANSWER } from "../../src/core/scheduler/discharges.js";
import type { EpochMs, RekeyedTestFile } from "../../src/core/types/index.js";
import { moved, settle, spyDischarges, stallRefinement, syncSocket } from "./held-socket.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Review wave-13s B2 (task 001-229): a held answer's hour was enforced only
 * when a later discharge, hold or read noticed it, so while the runner part
 * stalled and nothing else happened, its hold, the history it protected and
 * its pending answer all outlived the deadline. The reviewer's probe: the
 * real adapter, store, scheduler and socket handlers, a runner part held
 * before the real `invalidate`, discharges past both the cap and the age
 * bound, and Vitest's clock advanced past the hour with no further call.
 * Discharge times and files are synthetic; the hour is the fake clock's.
 */

function fakeClock(shouldAdvanceTime: boolean): void {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime });
  onTestFinished(() => {
    vi.useRealTimers();
  });
}

describe("a held answer's hour ends on time (review wave-13s B2)", () => {
  it(
    "ends each expired hold, prunes what only it kept and fails its answer while refinement stalls, a younger hold intact",
    SLOW,
    async () => {
      const instance = spyDischarges();
      const repo = createRepo();
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir);
      await h.scheduler.start();
      await h.scheduler.idle();
      const refinement = stallRefinement(h, "src/strings.ts");
      h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase(); // 1\n");
      await h.batch("src/strings.ts");
      const revision = h.scheduler.status().revision;
      // Real time still passes, so the stalled runner part can finish once released.
      fakeClock(true);
      const { syncs, ended, status, sync } = syncSocket(h);

      // Waits that started just before their requests, and a cap's worth of their news.
      const since = (Date.now() - 1) as EpochMs;
      const old = [sync(since), sync(since), sync(since)];
      await settle();
      const live = instance.discharges;
      if (live === undefined) throw new Error("no hold taken");
      for (let n = 0; n < DISCHARGE_CAP + 50; n += 1) {
        live.note(moved(`test/f${n}.test.ts`, revision), since);
      }
      expect(live.size).toBe(DISCHARGE_CAP + 50);

      // Half an hour on, a younger wait and its own news.
      await vi.advanceTimersByTimeAsync(HOLD_MS / 2);
      const youngSince = Date.now() as EpochMs;
      const young = sync(youngSince);
      await settle();
      live.note(moved("test/young.test.ts", revision), youngSince);
      expect(live.holds).toBe(old.length + 1);

      // Past the old holds' hour: no discharge, hold or read in between.
      await vi.advanceTimersByTimeAsync(HOLD_MS / 2 + 1_000);
      await settle();
      expect(live.holds).toBe(1);
      // Over both bounds: pruned at the deadline, by age, not only down to the cap.
      expect(live.size).toBe(1);
      for (const id of old) {
        expect(ended.get(id)).toBe(INCOMPLETE_ANSWER);
        expect(status(id)).toMatchObject({ revision: null, error: INCOMPLETE_ANSWER });
      }
      expect(ended.has(young)).toBe(false);
      expect(syncs.size).toBe(1);

      // The younger answer is complete: its window's news was kept.
      refinement.release();
      await expect.poll(() => status(young).revision, { timeout: 60_000 }).toBe(revision);
      expect(status(young).error).toBeNull();
      expect(status(young).rekeyed).toContainEqual({
        testFile: { project: "", path: "test/young.test.ts" },
        revision,
        resolved: true,
      });
      expect(live.holds).toBe(0);
      expect(syncs.size).toBe(0);
    },
  );

  it(
    "settles once and releases once when expiry races a forget or a normal answer, in either order",
    SLOW,
    async () => {
      const instance = spyDischarges();
      const repo = createRepo();
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir);
      await h.scheduler.start();
      await h.scheduler.idle();
      const revision = h.scheduler.status().revision;
      fakeClock(false);

      /** One answer whose refinement finishes on `refine`, forgotten on `forget`. */
      const answer = () => {
        let refine = () => {};
        vi.spyOn(h.scheduler, "refined").mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              refine = resolve;
            }),
        );
        const controller = new AbortController();
        const outcomes: (readonly RekeyedTestFile[] | string)[] = [];
        h.scheduler.rekeyedOnceRefined(0, revision, Date.now() as EpochMs, controller.signal).then(
          (files) => outcomes.push(files),
          (error: Error) => outcomes.push(error.message),
        );
        return { refine: () => refine(), forget: () => controller.abort(), outcomes };
      };
      const holds = () => instance.discharges?.holds ?? 0;
      const expire = () => vi.advanceTimersByTime(HOLD_MS);

      const cases: Record<string, (a: ReturnType<typeof answer>) => Promise<void>> = {
        "expiry, then forget": async (a) => {
          expire();
          await settle();
          a.forget();
        },
        "forget, then expiry": async (a) => {
          a.forget();
          await settle();
          expire();
        },
        "expiry, then the answer": async (a) => {
          expire();
          await settle();
          a.refine();
        },
        "expiry and the answer in one turn": async (a) => {
          a.refine();
          expire();
        },
      };
      for (const [name, race] of Object.entries(cases)) {
        const a = answer();
        await settle();
        expect(holds(), name).toBe(1);
        await race(a);
        await settle();
        a.refine();
        a.forget();
        expire();
        await settle();
        expect(a.outcomes, name).toEqual([INCOMPLETE_ANSWER]);
        expect(holds(), name).toBe(0);
      }

      // The answer, then expiry: complete, and the deadline after it is nothing.
      const a = answer();
      await settle();
      a.refine();
      await settle();
      expire();
      a.forget();
      await settle();
      expect(a.outcomes).toHaveLength(1);
      expect(a.outcomes[0]).toBeInstanceOf(Array);
      expect(holds()).toBe(0);
    },
  );
});
