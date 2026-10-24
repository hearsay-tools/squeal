import { describe, expect, it } from "vitest";
import type { TestFileRef } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { type CatchUpSide, catchUpRepo, catchUpSide } from "./catch-up-fixture.js";
import {
  CUT_WITHIN_MS,
  completions,
  heldRun,
  order,
  pause,
  SETTLE_MS,
} from "./tier-yields-fixture.js";

/*
 * Row 011-54 (review `reviews/0.1.237.md` B2): a runner that reports each
 * file's end as it happens (`RunOptions.fileEnded`, Vitest's
 * `onTestModuleEnd`) lets C4 step 5's first rule take only the files that
 * have not ended: a revision that re-keys every one of them cancels the
 * tier at once, and an ended file keeps its result under the completion
 * barrier and the stability check. A ends at once, B would take a minute;
 * both are known at 20 s, under the yield's 30 s, so only the first rule
 * cancels. A runner that reports no end keeps the whole-tier rule
 * (`tier-yields-ended.test.ts`).
 */
const [A, B, C] = ["test/a.test.ts", "test/b.test.ts", "test/c.test.ts"];

interface Ends {
  /** Reports `path`'s end now, in the run in flight that holds it and waits for `end`. */
  end(path: string): void;
}

/**
 * Each run reports its files' ends: after `delay` of the file, or, when it
 * gives `null`, when the test calls `end`. `drop` names the files of a run
 * its report leaves out though their ends were reported, as a crash or a
 * withheld file would.
 */
function reportEnds(
  side: CatchUpSide,
  delay: (path: string) => number | null,
  drop: (files: readonly TestFileRef[]) => readonly string[] = () => [],
): Ends {
  const waiting = new Map<string, () => void>();
  const run = side.runner.run.bind(side.runner);
  side.runner.run = async (files, options) => {
    const timers = files.flatMap((f) => {
      const fire = () => {
        if (options.signal?.aborted !== true) options.fileEnded?.(f);
      };
      const ms = delay(f.path);
      if (ms === null) waiting.set(f.path, fire);
      return ms === null ? [] : [setTimeout(fire, ms)];
    });
    try {
      const report = await run(files, options);
      const dropped = drop(files);
      return {
        ...report,
        completedFiles: report.completedFiles.filter((f) => !dropped.includes(f.path)),
        results: report.results.filter((r) => !dropped.includes(r.check.testPath)),
      };
    } finally {
      for (const timer of timers) clearTimeout(timer);
      for (const f of files) waiting.delete(f.path);
    }
  };
  return { end: (path) => waiting.get(path)?.() };
}

/**
 * A, B and C of `ms` known each; an edit's tier of A and B in flight, B's run taking a minute.
 * The start runs every file, so each has the `ms` its run stored: with none, the tier yields
 * only 30 s after its start, and a no-cancel check proved nothing of the 30 s rule (row 011-174).
 */
async function oneRunning(
  known: (path: string) => number,
  delay: (path: string) => number | null,
  drop?: (files: readonly TestFileRef[]) => readonly string[],
) {
  const files = [
    { path: A, ms: known(A), realMs: 0, imports: ["src/ab.ts"] },
    { path: B, ms: known(B), realMs: 0, imports: ["src/ab.ts"] },
    { path: C, ms: known(C), realMs: 0, imports: ["src/c.ts"] },
  ];
  const [, b] = files;
  if (b === undefined) throw new Error("no files");
  const repo = catchUpRepo(files);
  const side = catchUpSide(repo, repo.main, { files, hostSlots: 8, policy: RUN_MISSING });
  const ends = reportEnds(side, delay, drop);
  await side.scheduler.start();
  await side.scheduler.idle();
  const base = side.runner.runs.length;
  b.realMs = 60_000;
  await side.edit("watch", "src/ab.ts");
  const tier = await heldRun(side, B, base);
  // Read at a run's start: the tier keeps its minute, a later run takes none.
  b.realMs = 0;
  return { side, base, tier, ends };
}

const cancelledRuns = (side: CatchUpSide, after: number) =>
  side.runner.runs.slice(after).filter((r) => r.cancelled).length;

describe("a tier whose ended files the runner reports (row 011-54, spec 011 C4 step 5)", {
  timeout: 120_000,
}, () => {
  it("a revision that re-keys every unfinished file cancels it at once; the ended file keeps its result", async () => {
    const { side, base, tier } = await oneRunning(
      () => 20_000,
      (path) => (path === A ? 0 : null),
    );
    await pause(SETTLE_MS);
    const editAt = side.runner.runs.length;

    await side.edit("watch", B);
    await expect.poll(() => tier.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    await side.scheduler.idle();

    expect(tier.completed.map((f) => f.path)).toEqual([A]);
    expect(order(side, editAt)).toEqual([[B]]);
    expect(completions(side, A, base)).toBe(1);
    expect(completions(side, B, base)).toBe(1);
    expect(cancelledRuns(side, base)).toBe(1);
    expect([A, B].every((path) => side.current(path))).toBe(true);
  });

  it("the end of the last file a revision left unchanged cancels a tier whose other files it re-keyed", async () => {
    const { side, base, tier, ends } = await oneRunning(
      () => 20_000,
      () => null,
    );

    // A has not ended: B's save re-keys only some of the unfinished files.
    await side.edit("watch", B);
    await pause(SETTLE_MS);
    expect(tier.cancelled).toBe(false);

    ends.end(A);
    await expect.poll(() => tier.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    await side.scheduler.idle();

    expect(tier.completed.map((f) => f.path)).toEqual([A]);
    expect(completions(side, A, base)).toBe(1);
    expect(completions(side, B, base)).toBe(1);
    expect(cancelledRuns(side, base)).toBe(1);
    expect([A, B].every((path) => side.current(path))).toBe(true);
  });

  it("an ended file a later revision re-keys alone is discarded at the record; the tier runs on", async () => {
    const { side, base, tier, ends } = await oneRunning(
      () => 20_000,
      (path) => (path === A ? 0 : null),
    );
    await pause(SETTLE_MS);

    // Only A, which has ended: B is unchanged, so the tier is not superseded.
    await side.edit("watch", A);
    await pause(SETTLE_MS);
    expect(tier.cancelled).toBe(false);
    ends.end(B);
    await pause(SETTLE_MS);
    expect(tier.cancelled).toBe(false);

    // The stability check discards A's result of the run and A runs again at its new key.
    await side.scheduler.idle();
    expect(tier.completed.map((f) => f.path)).toEqual([A, B]);
    expect(completions(side, A, base)).toBe(2);
    expect(completions(side, B, base)).toBe(1);
    expect([A, B].every((path) => side.current(path))).toBe(true);
  });

  it("an ended file the report leaves out is queued again and runs", async () => {
    // The report of the tier in flight, once: it ran A and B.
    let armed = false;
    const drop = (files: readonly TestFileRef[]) => {
      if (!armed || !files.some((f) => f.path === B)) return [];
      armed = false;
      return [A];
    };
    const { side, base, tier } = await oneRunning(
      () => 20_000,
      (path) => (path === A ? 0 : null),
      drop,
    );
    armed = true;
    await pause(SETTLE_MS);
    const editAt = side.runner.runs.length;

    await side.edit("watch", B);
    await expect.poll(() => tier.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    await side.scheduler.idle();

    expect(armed).toBe(false);
    expect(order(side, editAt).flat().sort()).toEqual([A, B]);
    expect(completions(side, B, base)).toBe(1);
    expect([A, B].every((path) => side.current(path))).toBe(true);
  });

  // 80 s and 20 s: within `SHARE_RATIO`, so one edit's tier takes both.
  it("the remainder reads only the unfinished files: an ended 80 s file does not make it yield", async () => {
    const { side, base, tier } = await oneRunning(
      (path) => (path === A ? 80_000 : 20_000),
      (path) => (path === A ? 0 : null),
    );
    await pause(SETTLE_MS);

    // An edit's work in the tier's lane: the tier yields only when its remainder exceeds 30 s.
    await side.edit("watch", C);
    await pause(SETTLE_MS);
    expect(tier.cancelled).toBe(false);

    await side.edit("watch", B);
    await expect.poll(() => tier.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    await side.scheduler.idle();
    expect(tier.completed.map((f) => f.path)).toEqual([A]);
    expect(cancelledRuns(side, base)).toBe(1);
    expect([A, B, C].every((path) => side.current(path))).toBe(true);
  });
});
