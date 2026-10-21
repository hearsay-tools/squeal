import { describe, expect, it } from "vitest";
import { type CatchUpFile, catchUpRepo, catchUpSide } from "./catch-up-fixture.js";
import {
  CUT_WITHIN_MS,
  completions,
  heldRun,
  holdRuns,
  pause,
  ref,
  SETTLE_MS,
} from "./tier-yields-fixture.js";

/*
 * Row 011-51, tests 5 and 6 of `research/running-tier-yields.md` (spec 011
 * C4 step 5 as amended 2026-10-21): a yield cuts each file at its key once,
 * so repeated saves cannot cancel the same files without end; the backlog's
 * turn after four tiers of the first group yields to nothing but a revision
 * whose results it would discard.
 */
const SLOW = [1, 2, 3, 4].map((i) => `test/s${i}.test.ts`);
const isSlow = (path: string) => SLOW.includes(path);

describe("a running tier yields once per file and key (spec 011 C4 step 5 as amended 2026-10-21)", {
  timeout: 120_000,
}, () => {
  it("5: the cut files' next run yields to neither an edit nor a named wait, but a supersession cancels it", async () => {
    const [G1, G2] = ["test/g1.test.ts", "test/g2.test.ts"];
    const files: CatchUpFile[] = [
      ...SLOW.map((path) => ({ path, ms: 100_000, imports: ["src/s.ts"] })),
      { path: G1, ms: 1, imports: ["src/g1.ts"] },
      { path: G2, ms: 1, imports: ["src/g2.ts"] },
    ];
    const repo = catchUpRepo(files);
    const side = catchUpSide(repo, repo.main, { files, hostSlots: 8 });
    await side.scheduler.start();
    await side.scheduler.idle();
    const base = side.runner.runs.length;
    const gate = holdRuns(side.runner, isSlow);
    const s1 = SLOW[0] ?? "";
    await side.edit("watch", "src/s.ts");
    const first = await heldRun(side, s1, base);

    // An edit elsewhere: the tier yields, and its files run again after the edit's.
    await side.edit("watch", "src/g1.ts");
    await expect.poll(() => first.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    const again = await heldRun(side, s1, side.runner.runs.indexOf(first) + 1);

    // A second edit and a second named wait: the files a yield cut at these keys run on.
    await side.edit("watch", "src/g2.ts");
    await side.scheduler.promote([ref(G2)], 60_000);
    await pause(SETTLE_MS);
    expect(again.cancelled).toBe(false);
    expect(again.endedAt).toBeNull();

    // A third save re-keys all of it: its results would be discarded, so it is cancelled.
    await side.edit("watch", "src/s.ts");
    await expect.poll(() => again.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    gate.stop();
    await side.scheduler.idle();

    for (const path of SLOW) {
      // Twice at the first key, both cut; once at the third save's, to its end.
      expect(side.runner.runsOf(path).slice(-3)).toEqual([first, again, expect.anything()]);
      expect(completions(side, path, base)).toBe(1);
    }
    expect(files.every((f) => side.current(f.path))).toBe(true);
  });

  it("6: the backlog's turn yields to nothing but a revision that re-keys every file of it", async () => {
    const B = "b/b.test.ts";
    const G = "test/g.test.ts";
    const edits = [1, 2, 3, 4, 5].map((i) => `test/e${i}.test.ts`);
    const files: CatchUpFile[] = [
      ...edits.map((path) => ({ path, ms: 1, imports: ["src/e.ts"] })),
      { project: "b", path: B, ms: 100_000, imports: ["src/b.ts"] },
      { path: G, ms: 1, imports: ["src/g.ts"] },
    ];
    const repo = catchUpRepo(files);
    // Tiers of one file: four of the edit's, then the backlog's turn takes the re-keyed file.
    const side = catchUpSide(repo, repo.main, { files, hostSlots: 8, tierSize: 1 });
    await side.scheduler.start();
    await side.scheduler.idle();
    const base = side.runner.runs.length;
    const gate = holdRuns(side.runner, (path) => path === B);
    await side.edit("watch", "src/e.ts", "b.config.json");
    const turn = await heldRun(side, B, base);
    expect(side.runner.runs.slice(base, side.runner.runs.indexOf(turn))).toHaveLength(4);
    expect(turn.workers).toBeDefined();

    await side.edit("watch", "src/g.ts");
    await side.scheduler.promote([ref(G)], 60_000);
    await pause(SETTLE_MS);
    expect(turn.cancelled).toBe(false);
    expect(turn.endedAt).toBeNull();

    await side.edit("watch", "b.config.json");
    await expect.poll(() => turn.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    gate.stop();
    await side.scheduler.idle();
    expect(files.every((f) => side.current(f.path))).toBe(true);
  });
});
