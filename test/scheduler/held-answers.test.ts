import { describe, expect, it, onTestFinished, vi } from "vitest";
import { createHandlers } from "../../src/core/daemon/handlers.js";
import { SyncRequests } from "../../src/core/daemon/sync-requests.js";
import {
  DISCHARGE_CAP,
  Discharges,
  HOLD_MS,
  INCOMPLETE_ANSWER,
} from "../../src/core/scheduler/discharges.js";
import { newFileState } from "../../src/core/scheduler/files.js";
import type { DaemonResponse, EpochMs, SyncResponse } from "../../src/core/types/index.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Review wave-13r B2 (task 001-226): an answer's hold outlived its request.
 * The reviewer's probe: the real adapter, store and scheduler, a runner part
 * held before the real `invalidate`, and `sync` requests through the real
 * socket handlers into `Scheduler.rekeyedOnceRefined`, as the daemon routes
 * them (its reconciliation pass aside), through its `SyncRequests`. 40 holds
 * stayed, none released, and past the cap and the hour every discharge they
 * covered stayed too. Now a request the handlers drop from their 32 is
 * forgotten and its hold released at once, while the refinement is still
 * held; none outlives `HOLD_MS`; and an answer whose hold ended before it
 * was read fails instead of naming fewer files. Holds are counted at the
 * scheduler's own `Discharges`. Discharge times and files are synthetic; the
 * hour is simulated through their times.
 */

/** How many sync requests the socket remembers. */
const REMEMBERED = 32;

const settle = () => new Promise((resolve) => setImmediate(resolve));

function asSync(response: DaemonResponse): SyncResponse {
  if (!response.ok || response.type !== "sync") throw new Error(JSON.stringify(response));
  return response;
}

describe("held sync answers are bounded (review wave-13r B2)", () => {
  it(
    "releases a dropped request's hold at once, holds at most 32 while refinement is stalled, none past the deadline",
    SLOW,
    async () => {
      const instance: { discharges?: Discharges } = {};
      const hold = Discharges.prototype.hold;
      vi.spyOn(Discharges.prototype, "hold").mockImplementation(function (
        this: Discharges,
        ...args
      ) {
        instance.discharges = this;
        return hold.apply(this, args);
      });
      onTestFinished(() => {
        vi.restoreAllMocks();
      });
      const repo = createRepo();
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir);
      await h.scheduler.start();
      await h.scheduler.idle();

      // A revision whose runner part waits before the real `invalidate`.
      let releaseRefinement = () => {};
      const refinement = new Promise<void>((resolve) => {
        releaseRefinement = resolve;
      });
      onTestFinished(releaseRefinement);
      const invalidate = h.runner.invalidate;
      h.runner.invalidate = async (paths) => {
        if (paths.some((path) => path.path === "src/strings.ts")) await refinement;
        return invalidate(paths);
      };
      h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase(); // 1\n");
      await h.batch("src/strings.ts");
      const revision = h.scheduler.status().revision;

      // As the daemon wires its socket: each answer under its request id, forgotten when dropped.
      const syncs = new SyncRequests();
      const ended = new Map<string, string>();
      const handle = createHandlers({
        worktreeId: h.worktreeId,
        root: h.root as never,
        squealVersion: "0.0.0-test",
        startedAt: 1 as never,
        phase: () => "ready",
        requestFullSuite: () => new Promise(() => {}),
        requestSync: (after, resolvedSince, id) => {
          const answer = syncs.run(id, async (signal) => {
            const upTo = h.scheduler.status().revision;
            if (after === null) return { revision: upTo, rekeyed: null };
            const rekeyed = await h.scheduler.rekeyedOnceRefined(
              after,
              upTo,
              resolvedSince ?? undefined,
              signal,
            );
            return { revision: upTo, rekeyed };
          });
          answer.then(
            () => ended.set(id, "answered"),
            (error: Error) => ended.set(id, error.message),
          );
          return answer;
        },
        forgetSync: (id) => syncs.forget(id),
        onActivity: () => {},
        onStop: () => {},
        onStepDown: () => {},
      });
      const status = (requestId: string) => handle({ type: "sync-status", requestId });
      const holds = () => instance.discharges?.holds ?? 0;

      const since = Date.now() as EpochMs;
      const ids: string[] = [];
      for (let n = 0; n < 40; n += 1) {
        ids.push(asSync(handle({ type: "sync", after: 0, resolvedSince: since })).requestId);
        await settle();
        expect(holds()).toBeLessThanOrEqual(REMEMBERED);
      }
      expect(holds()).toBe(REMEMBERED);
      expect(syncs.size).toBe(REMEMBERED);
      // The first 8 left the map; their answers failed at once, the refinement still held.
      const evicted = ids.slice(0, 8);
      for (const id of evicted) {
        expect(status(id)).toMatchObject({ ok: false });
        expect(ended.get(id)).toBe(INCOMPLETE_ANSWER);
      }
      expect(ended.size).toBe(evicted.length);
      expect(asSync(status(ids[8] ?? ""))).toMatchObject({ revision: null, error: null });

      // A forget of an unknown or already released id is nothing.
      syncs.forget("no-such-request");
      syncs.forget(evicted[0] ?? "");
      expect(holds()).toBe(REMEMBERED);
      expect(ended.size).toBe(evicted.length);

      // A full cap of the window's discharges, then one past the hour: no hold outlives it.
      const live = instance.discharges;
      if (live === undefined) throw new Error("no hold taken");
      const moved = (path: string) => ({
        ...newFileState({ project: "", path }),
        keyedAt: revision,
        lastKeyedAt: revision,
      });
      for (let n = 0; n < DISCHARGE_CAP + 50; n += 1) {
        live.note(moved(`test/f${n}.test.ts`), since);
      }
      expect(live.size).toBe(DISCHARGE_CAP + 50);
      // Every hold was taken by now, so an hour after now is past each one's deadline.
      const later = (Date.now() + HOLD_MS + 1) as EpochMs;
      live.note(moved("test/late.test.ts"), later);
      expect(live.holds).toBe(0);
      expect(live.size).toBe(1);

      // Each answer still in the map fails, read after its hold ended: never fewer files.
      releaseRefinement();
      for (const id of ids.slice(8)) {
        await expect
          .poll(() => asSync(status(id)).error, { timeout: 30_000 })
          .toBe(INCOMPLETE_ANSWER);
        expect(asSync(status(id)).revision).toBeNull();
      }
      // A wait whose request was evicted asks again: its window lost discharges, so it fails too.
      const again = asSync(handle({ type: "sync", after: 0, resolvedSince: since })).requestId;
      await expect
        .poll(() => asSync(status(again)).error, { timeout: 30_000 })
        .toBe(INCOMPLETE_ANSWER);
      // One started now lost nothing and is answered.
      const fresh = asSync(
        handle({ type: "sync", after: 0, resolvedSince: (later + 1) as EpochMs }),
      ).requestId;
      await expect.poll(() => asSync(status(fresh)).revision, { timeout: 30_000 }).toBe(revision);
      expect(asSync(status(fresh)).error).toBeNull();
      expect(live.holds).toBe(0);
      expect(syncs.size).toBe(0);
    },
  );
});
