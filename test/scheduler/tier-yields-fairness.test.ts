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
 * whose results it would discard. Review `reviews/0.1.237.md` B1: a file
 * `run --all --force` queued already has a result at its key, which is no
 * result after the cut; a mark ends only at one, or when the key moves.
 */
const SLOW = [1, 2, 3, 4].map((i) => `test/s${i}.test.ts`);
const isSlow = (path: string) => SLOW.includes(path);

const H = "test/h.test.ts";
const [Q1, Q2] = ["test/q1.test.ts", "test/q2.test.ts"];

/**
 * A known failing file of 120 s and two of 1 ms, run once; then
 * `run --all --force` runs the failing one first, alone and held, and a
 * named wait on `Q1` cuts it. Returns once it runs again at its key, held.
 */
async function forcedAndCut() {
  const files: CatchUpFile[] = [
    { path: H, ms: 120_000, imports: ["src/h.ts"] },
    { path: Q1, ms: 1, imports: ["src/q1.ts"] },
    { path: Q2, ms: 1, imports: ["src/q2.ts"] },
  ];
  const repo = catchUpRepo(files);
  // Tiers of one file, so the two short ones stay queued behind it.
  const side = catchUpSide(repo, repo.main, {
    files,
    hostSlots: 8,
    tierSize: 1,
    backlogTierSize: 1,
  });
  side.runner.failing.add(H);
  await side.scheduler.start();
  await side.scheduler.idle();
  const base = side.runner.runs.length;
  const gate = holdRuns(side.runner, (path) => path === H);
  const checkpoint = await side.scheduler.requestFullSuite({ force: true });
  const first = await heldRun(side, H, base);
  // Its result at this key stays current while the forced run is pending.
  expect(side.current(H)).toBe(true);

  await side.scheduler.promote([ref(Q1)], 60_000);
  await expect.poll(() => first.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
  const again = await heldRun(side, H, side.runner.runs.indexOf(first) + 1);
  expect(completions(side, Q1, base)).toBe(1);
  // The second short file is still queued behind it.
  expect(completions(side, Q2, base)).toBe(0);
  return { side, base, gate, checkpoint, again };
}

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

  it("a forced file a yield cut is not cut again at its key: its old result is no result after the cut", async () => {
    const { side, base, gate, checkpoint, again } = await forcedAndCut();

    // A second named wait: before review 0.1.237 B1 it cut the file again, at the same key.
    await side.scheduler.promote([ref(Q2)], 60_000);
    await pause(SETTLE_MS);
    expect(again.cancelled).toBe(false);
    expect(again.endedAt).toBeNull();
    expect(side.current(H)).toBe(true);

    gate.stop();
    await side.scheduler.idle();
    expect(completions(side, H, base)).toBe(1);
    expect(side.store.checkpoints.get(checkpoint.id)?.end).toBe("completed");
    expect([H, Q1, Q2].every((path) => side.current(path))).toBe(true);
  });

  it("a result accepted after the cut ends the mark: the next forced run at that key yields", async () => {
    const { side, base, gate, again } = await forcedAndCut();
    // The run at the key cut ends and stores; the runs after it are held again.
    side.runner.release();
    await side.scheduler.idle();
    expect(again.completed.map((f) => f.path)).toEqual([H]);
    expect(completions(side, H, base)).toBe(1);

    const next = side.runner.runs.length;
    const checkpoint = await side.scheduler.requestFullSuite({ force: true });
    const third = await heldRun(side, H, next);
    await side.scheduler.promote([ref(Q1)], 60_000);
    await expect.poll(() => third.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);

    gate.stop();
    await side.scheduler.idle();
    expect(side.store.checkpoints.get(checkpoint.id)?.end).toBe("completed");
    expect([H, Q1, Q2].every((path) => side.current(path))).toBe(true);
  });

  it("a key move ends the mark: the file a yield cut yields again at its new key", async () => {
    const { side, gate, again } = await forcedAndCut();
    // An edit re-keys all of the run at the key cut: the supersession cancels it.
    await side.edit("watch", "src/h.ts");
    await expect.poll(() => again.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    const moved = await heldRun(side, H, side.runner.runs.indexOf(again) + 1);

    await side.scheduler.promote([ref(Q2)], 60_000);
    await expect.poll(() => moved.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);

    gate.stop();
    await side.scheduler.idle();
    expect([H, Q1, Q2].every((path) => side.current(path))).toBe(true);
  });
});
