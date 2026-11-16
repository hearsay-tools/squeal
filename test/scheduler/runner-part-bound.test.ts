import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { CLAIM_UNBOUNDED_MS } from "../../src/core/scheduler/claims.js";
import {
  RUNNER_PART_MARGIN_MS,
  RunnerPartBound,
  runnerPartBoundMs,
} from "../../src/core/scheduler/runner-work-bound.js";
import { Wakes } from "../../src/core/scheduler/wakes.js";
import type { DaemonNote } from "../../src/core/types/scheduler.js";
import { worktreeMetaKey } from "../../src/core/types/store.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { virtualClock } from "../helpers/virtual-clock.js";
import { catchUpRepo, catchUpSide } from "./catch-up-fixture.js";
import { SLOW } from "./cleanup.js";
import { createRepo, openRepoStore } from "./repo.js";
import { type Harness, openHarness } from "./vitest-harness.js";

/*
 * Review wave-13r B2 (task 001-228): a runner-part call had no maximum
 * duration, so one that stalled held its revision's results, and every
 * `status --wait` for them, to the wait's own timeout. Past its bound it is
 * abandoned with a note, and the revision proceeds.
 */

const BOUND_MS = 400;

function notes(h: Harness): string[] {
  const raw = h.store.meta.get(worktreeMetaKey("notes", h.worktreeId));
  return raw === null ? [] : (JSON.parse(raw) as DaemonNote[]).map((note) => note.text);
}

/** Holds the next `invalidate` until the test ends, then lets it reach the adapter. */
function stallNextInvalidate(h: Harness): void {
  let release = () => {};
  const stalled = new Promise<void>((resolve) => {
    release = resolve;
  });
  onTestFinished(release);
  const invalidate = h.runner.invalidate;
  let first = true;
  h.runner.invalidate = async (paths) => {
    if (first) {
      first = false;
      await stalled;
    }
    return invalidate(paths);
  };
}

describe("a runner part has a maximum duration (task 001-228)", () => {
  it(
    "abandons a stalled invalidate past its bound, and the next revision's results land",
    SLOW,
    async () => {
      const repo = createRepo();
      // Row 011-367 (row 011-360): the bound fires on the scheduler's virtual clock, never on the host's.
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        runnerPartMs: BOUND_MS,
        policy: RUN_MISSING,
        clock: "virtual",
      });
      await h.scheduler.start();
      await h.quiet();
      const runs = h.runsOf("test/math.test.ts").length;

      stallNextInvalidate(h);
      h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // 1\n");
      await h.batch("src/math.ts");
      const stated = h.now() + BOUND_MS;
      // The stalled call waits for the bound's wake: the scheduler rests and names it.
      const waiting = await h.rest();
      expect(waiting.wakes).toContainEqual({ reason: "runner-part-bound", at: stated });
      expect(h.header()).toMatchObject({ revision: 1, refinedRevision: 0 });
      // The stalled call never answers before the test ends: past the bound the revision proceeds without it.
      h.advance(BOUND_MS);
      await h.quiet();
      expect((await h.rest()).wakes.map((wake) => wake.reason)).not.toContain("runner-part-bound");
      expect(h.header()).toMatchObject({ revision: 1, refinedRevision: 1 });
      expect(h.header().counts.unknown).toBeGreaterThan(0);
      expect(notes(h)).toContainEqual(
        expect.stringMatching(
          /^runner invalidate \(src\/math\.ts\) failed: no answer within 400 ms; the call was abandoned$/,
        ),
      );
      expect(h.runsOf("test/math.test.ts")).toHaveLength(runs);

      h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // 2\n");
      await h.batch("src/math.ts");
      await h.quiet();
      const header = h.header();
      expect(header).toMatchObject({ revision: 2, refinedRevision: 2 });
      expect(header.counts).toMatchObject({ unknown: 0, pending: 0, stale: 0 });
      expect(h.runsOf("test/math.test.ts")).toHaveLength(runs + 1);
    },
  );
});

describe("RunnerPartBound (task 001-228)", () => {
  it("is the run's own bound plus a margin", () => {
    expect(runnerPartBoundMs(600_000)).toBe(600_000 + 6_000 + RUNNER_PART_MARGIN_MS);
    expect(runnerPartBoundMs(null)).toBe(CLAIM_UNBOUNDED_MS + 6_000 + RUNNER_PART_MARGIN_MS);
  });

  it("answers within its bound, abandons past it and makes no later call of that part", async () => {
    // Row 011-352: the bound's wake is the loop's, here on the virtual clock.
    const clock = virtualClock(1_000);
    const bound = new RunnerPartBound(5_000, new Wakes(clock));
    await expect(bound.call(() => Promise.resolve("answered"))).resolves.toBe("answered");
    expect(clock.armed).toBe(0);

    let late = (_: Error) => {};
    const stalled = bound.call(
      () =>
        new Promise<never>((_, reject) => {
          late = reject;
        }),
    );
    const outcome = stalled.catch((error: Error) => error.message);
    clock.advance(4_999);
    clock.advance(1);
    await expect(outcome).resolves.toBe("no answer within 5 s; the call was abandoned");
    expect(clock.armed).toBe(0);

    const next = vi.fn(() => Promise.resolve("answered"));
    await expect(bound.call(next)).rejects.toThrow("no answer within 5 s; the call was abandoned");
    expect(next).not.toHaveBeenCalled();
    // A rejection after the bound is dropped, not unhandled.
    late(new Error("vitest adapter: closed"));
    await Promise.resolve();
  });
});

/** Whether `promise` settles within `ms` of real time. */
async function settles<T>(promise: Promise<T>, ms: number): Promise<T | "unsettled"> {
  return Promise.race([promise, delay(ms).then(() => "unsettled" as const)]);
}

describe("a revision's runner part arms its bound on the scheduler's loop (row 011-362)", () => {
  it(
    "on the virtual clock, rest reports the bound's wake and advancing past it abandons the call",
    SLOW,
    async () => {
      const files = [{ path: "test/a.test.ts", ms: 1, imports: ["src/a.ts"] }];
      const repo = catchUpRepo(files);
      // A bound of a minute: on the host clock it cannot fire while the test runs.
      const side = catchUpSide(repo, repo.main, {
        files,
        hostSlots: 2,
        policy: RUN_MISSING,
        clock: "virtual",
        runnerPartMs: 60_000,
      });
      await side.scheduler.start();
      await side.rest();

      let release = () => {};
      onTestFinished(() => release());
      const invalidate = side.runner.invalidate;
      side.runner.invalidate = async () => {
        side.runner.invalidate = invalidate;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return invalidate();
      };
      await side.edit("watch", "src/a.ts");
      const stated = side.now() + 60_000;

      // The stalled call waits for the loop's wake, so the scheduler rests and names it.
      const rest = await settles(side.rest(), 5_000);
      expect(rest).not.toBe("unsettled");
      expect(rest === "unsettled" ? [] : rest.wakes).toContainEqual({
        reason: "runner-part-bound",
        at: stated,
      });

      side.advance(60_000);
      const after = await side.rest();
      expect(after.wakes.map((wake) => wake.reason)).not.toContain("runner-part-bound");
      const raw = side.store.meta.get(worktreeMetaKey("notes", side.worktreeId));
      const texts = raw === null ? [] : (JSON.parse(raw) as DaemonNote[]).map((n) => n.text);
      expect(texts).toContainEqual(
        expect.stringMatching(/^runner invalidate \(src\/a\.ts\) failed: no answer within 60 s;/),
      );
    },
  );
});
