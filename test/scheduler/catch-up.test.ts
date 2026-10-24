import { describe, expect, it } from "vitest";
import type { RevisionTrigger } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpOptions,
  catchUpRepo,
  catchUpSide,
  sources,
  testFiles,
} from "./catch-up-fixture.js";
import { wallOf } from "./wall-fixture.js";

/*
 * Task 011-22 (spec 011 C4 step 4 as amended 2026-10-20, `research/catch-up.md`
 * done-when 1 to 3): a revision that changes 10 or more keyed paths causes
 * no edit's work, whatever its trigger; the files it re-keys are catch-up,
 * on the backlog's route (the pool's grant, the 120 s budget). On cezar a
 * pull's 733 re-keyed files ran as edit tiers of 4, one at a time and
 * without a permit.
 */
const TWELVE = sources(12);
// 480 files of 0.1 to 5 s, plus one of 60 s, file i importing source i % 12.
const FILES = testFiles(481, TWELVE, (i) => (i === 480 ? 60_000 : 100 + ((i * 37) % 480) * 10));
const OPTIONS: CatchUpOptions = { files: FILES, hostSlots: 23, tierSize: 4 };

/** A daemon whose baseline ran, ready for a change. */
async function started(options: CatchUpOptions = OPTIONS) {
  const repo = catchUpRepo(options.files);
  const side = catchUpSide(repo, repo.main, options);
  await side.scheduler.start();
  await side.scheduler.idle();
  return { repo, side };
}

/** The first run after `before`, once one is in flight. */
async function firstRun(side: ReturnType<typeof catchUpSide>, before: number) {
  await expect.poll(() => side.runner.runs.length, { timeout: 30_000 }).toBeGreaterThan(before);
  const run = side.runner.runs[before];
  if (run === undefined) throw new Error("no run");
  return run;
}

/** Whether `run` is a backlog tier: a grant from the pool and more files than a tier of the edit's. */
function backlogTier(run: { workers: number | undefined; files: readonly unknown[] }) {
  return { granted: run.workers !== undefined, wide: run.files.length > 4 };
}

describe("scheduler: a revision of 10 or more keyed paths is catch-up (C4 step 4, task 011-22)", {
  timeout: 120_000,
}, () => {
  it("1. runs a 12-source change's 480 files as a backlog tier: a grant, more than a tier of 4, within 120 s", async () => {
    const { side } = await started();
    side.runner.hold();
    const before = side.runner.runs.length;
    await side.edit("watch", ...TWELVE);
    const run = await firstRun(side, before);
    expect(backlogTier(run)).toEqual({ granted: true, wide: true });
    const byPath = new Map(FILES.map((f) => [f.path, f.ms]));
    const durations = run.files.map((f) => byPath.get(f.path) ?? 0);
    expect(wallOf(durations, run.workers ?? 1)).toBeLessThanOrEqual(120_000);
    // Shortest first: the 60 s file is not in the first tier.
    expect(run.files.map((f) => f.path)).not.toContain("test/f480.test.ts");
    side.runner.release();
    await side.scheduler.idle();
    const after = side.runner.runs.slice(before);
    // Every file ran once at its new key, and every tier took the backlog's route.
    expect(after.flatMap((r) => r.files)).toHaveLength(481);
    expect(after.every((r) => r.workers !== undefined)).toBe(true);
    expect(FILES.every((f) => side.current(f.path))).toBe(true);
  });

  it("2. runs the same change across 9 sources as edit tiers of runner.tierSize, as before", async () => {
    const { side } = await started();
    side.runner.hold();
    const before = side.runner.runs.length;
    await side.edit("watch", ...TWELVE.slice(0, 9));
    const run = await firstRun(side, before);
    expect(backlogTier(run)).toEqual({ granted: false, wide: false });
    side.runner.release();
    await side.scheduler.idle();
    const after = side.runner.runs.slice(before);
    expect(after.flatMap((r) => r.files)).toHaveLength(FILES.filter((_, i) => i % 12 < 9).length);
    expect(after.every((r) => r.workers === undefined && r.files.length <= 4)).toBe(true);
  });

  it.each<RevisionTrigger>(["watch", "interval"])(
    "3. is catch-up as a %s revision",
    async (trigger) => {
      const { side } = await started();
      side.runner.hold();
      const before = side.runner.runs.length;
      await side.edit(trigger, ...TWELVE);
      expect(backlogTier(await firstRun(side, before))).toEqual({ granted: true, wide: true });
    },
  );

  it("3. is catch-up as a daemon start's revision under lookup-then-run-missing", async () => {
    const { repo, side } = await started();
    await side.scheduler.close();
    // A pull while no daemon ran: the next start's `start` revision holds it.
    side.touch(...TWELVE);
    const next = catchUpSide(repo, repo.main, { ...OPTIONS, policy: RUN_MISSING });
    next.runner.hold();
    await next.scheduler.start();
    const run = await firstRun(next, 0);
    expect(backlogTier(run)).toEqual({ granted: true, wide: true });
    next.runner.release();
    await next.scheduler.idle();
    expect(next.runner.runs.flatMap((r) => r.files)).toHaveLength(481);
  });
});
