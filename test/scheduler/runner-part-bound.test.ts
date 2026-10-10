import { describe, expect, it, onTestFinished, vi } from "vitest";
import { CLAIM_UNBOUNDED_MS } from "../../src/core/scheduler/claims.js";
import {
  RUNNER_PART_MARGIN_MS,
  RunnerPartBound,
  runnerPartBoundMs,
} from "../../src/core/scheduler/runner-work-bound.js";
import { type DaemonNote, notesMetaKey } from "../../src/core/types/index.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Review wave-13r B2 (task 001-228): a runner-part call had no maximum
 * duration, so one that stalled held its revision's results, and every
 * `status --wait` for them, to the wait's own timeout. Past its bound it is
 * abandoned with a note, and the revision proceeds.
 */

const BOUND_MS = 400;

function notes(h: Harness): string[] {
  const raw = h.store.meta.get(notesMetaKey(h.worktreeId));
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
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        runnerPartMs: BOUND_MS,
      });
      await h.scheduler.start();
      await h.scheduler.idle();
      const runs = h.runsOf("test/math.test.ts").length;

      stallNextInvalidate(h);
      h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // 1\n");
      const started = Date.now();
      await h.batch("src/math.ts");
      // The stalled call never answers before the test ends: the revision proceeds without it.
      await h.scheduler.idle();
      expect(Date.now() - started).toBeGreaterThanOrEqual(BOUND_MS - 50);
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
      await h.scheduler.idle();
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
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const bound = new RunnerPartBound(5_000);
    await expect(bound.call(() => Promise.resolve("answered"))).resolves.toBe("answered");
    expect(vi.getTimerCount()).toBe(0);

    let late = (_: Error) => {};
    const stalled = bound.call(
      () =>
        new Promise<never>((_, reject) => {
          late = reject;
        }),
    );
    const outcome = stalled.catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(4_999);
    await vi.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toBe("no answer within 5 s; the call was abandoned");
    expect(vi.getTimerCount()).toBe(0);

    const next = vi.fn(() => Promise.resolve("answered"));
    await expect(bound.call(next)).rejects.toThrow("no answer within 5 s; the call was abandoned");
    expect(next).not.toHaveBeenCalled();
    // A rejection after the bound is dropped, not unhandled.
    late(new Error("vitest adapter: closed"));
    await Promise.resolve();
  });
});
