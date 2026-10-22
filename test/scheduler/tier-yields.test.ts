import { describe, expect, it } from "vitest";
import { type CatchUpFile, catchUpRepo, catchUpSide } from "./catch-up-fixture.js";
import {
  CUT_WITHIN_MS,
  completions,
  heldRun,
  holdRuns,
  order,
  pause,
  ref,
  SETTLE_MS,
} from "./tier-yields-fixture.js";

/*
 * Row 011-51, tests 1 to 4 of `research/running-tier-yields.md` ("The
 * slice's done-when, as tests"; spec 011 C4 step 5 and C15 as amended
 * 2026-10-21, the human: rule B at 30 s). Before it, an edit's tier in flight
 * ran to its end whatever came: a revision that re-keyed all of it ran its
 * files twice (gh-63, case A of `probes/issue-63/`), and a named wait waited
 * for it (#69). One lane; a held run stands for one of its files' `ms`.
 */
const SLOW = [1, 2, 3, 4].map((i) => `test/s${i}.test.ts`);
const isSlow = (path: string) => SLOW.includes(path);

describe("a running tier yields (spec 011 C4 step 5 as amended 2026-10-21, row 011-51)", {
  timeout: 120_000,
}, () => {
  it("1: a revision that re-keys every file of an edit's tier in flight cancels it", async () => {
    const REG = "test/reg.test.ts";
    // 20 s known: the tier would not yield, so only the supersession cancels it.
    const files: CatchUpFile[] = [
      { path: REG, ms: 1, imports: ["src/waits.ts"] },
      ...SLOW.map((path) => ({ path, ms: 20_000, imports: ["src/waits.ts"] })),
    ];
    const repo = catchUpRepo(files);
    const side = catchUpSide(repo, repo.main, { files, hostSlots: 8 });
    await side.scheduler.start();
    await side.scheduler.idle();
    const base = side.runner.runs.length;
    const gate = holdRuns(side.runner, isSlow);
    await side.edit("watch", "src/waits.ts");
    const cut = await heldRun(side, SLOW[0] ?? "", base);
    const fixAt = side.runner.runs.length;

    // The fix re-keys the four files in flight and the regression, and a wait names it.
    await side.edit("watch", "src/waits.ts");
    await side.scheduler.promote([ref(REG)], 60_000);
    await expect.poll(() => cut.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    gate.stop();
    await side.scheduler.idle();

    expect(cut.completed).toEqual([]);
    const after = order(side, fixAt);
    expect(after[0]).toEqual([REG]);
    expect([...(after[1] ?? [])].sort()).toEqual(SLOW);
    expect(after).toHaveLength(2);
    // Each slow file ran to its end once since the first edit: at its new key (gh-63 case A: twice).
    for (const path of SLOW) expect(completions(side, path, base)).toBe(1);
    expect(files.every((f) => side.current(f.path))).toBe(true);
  });

  it("2: a revision that re-keys one file of four yields the tier; what ended keeps its result", async () => {
    // S4 ends at once; the others would take a minute, past any wait.
    const files = SLOW.map((path, i) => ({
      path,
      ms: 100_000,
      realMs: i === 3 ? 0 : 60_000,
      imports: i === 0 ? ["src/one.ts", "src/s.ts"] : ["src/s.ts"],
    }));
    const [s1, s2, s3, s4] = SLOW;
    const repo = catchUpRepo(files);
    const side = catchUpSide(repo, repo.main, { files, hostSlots: 8 });
    await side.scheduler.start();
    await side.scheduler.idle();
    const base = side.runner.runs.length;
    await side.edit("watch", "src/s.ts");
    const cut = await heldRun(side, s1 ?? "", base);
    // Read at a run's start: the cut tier keeps its minute, a later run takes none.
    for (const file of files) file.realMs = 0;
    const fixAt = side.runner.runs.length;

    await side.edit("watch", "src/one.ts");
    await expect.poll(() => cut.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    await side.scheduler.idle();

    expect(cut.completed.map((f) => f.path)).toEqual([s4]);
    // The edit's file leads, the cut files after it; the one that ended runs no more.
    expect(order(side, fixAt)).toEqual([[s1, s2, s3]]);
    expect(completions(side, s4 ?? "", base)).toBe(1);
    expect(SLOW.every((path) => side.current(path))).toBe(true);
  });

  it("3: a named wait on a failing file makes the tier it is queued behind yield", async () => {
    const F = "f/f.test.ts";
    const files: CatchUpFile[] = [
      ...SLOW.map((path) => ({ path, ms: 200_000, imports: ["src/s.ts"] })),
      { project: "f", path: F, ms: 1, imports: ["src/f.ts"] },
    ];
    const repo = catchUpRepo(files);
    const side = catchUpSide(repo, repo.main, { files, hostSlots: 8 });
    side.runner.failing.add(F);
    await side.scheduler.start();
    await side.scheduler.idle();
    const base = side.runner.runs.length;
    const gate = holdRuns(side.runner, isSlow);
    // An edit's tier of the four; the failing file is re-keyed by its project's environment, behind it.
    await side.edit("watch", "src/s.ts", "f.config.json");
    const cut = await heldRun(side, SLOW[0] ?? "", base);
    const waitAt = side.runner.runs.length;

    await side.scheduler.promote([ref(F, "f")], 60_000);
    await expect.poll(() => cut.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    // Current while the cut files, still held, run again.
    await expect.poll(() => side.current(F), { timeout: CUT_WITHIN_MS }).toBe(true);
    gate.stop();
    await side.scheduler.idle();

    const after = side.runner.runs.slice(waitAt);
    expect(after.map((r) => r.files.map((f) => f.path))).toEqual([[F], SLOW]);
    // The cut files went back as an edit's work: theirs is an edit's tier, with no grant.
    expect(after[1]?.workers).toBeUndefined();
    expect(SLOW.every((path) => side.current(path))).toBe(true);
  });

  it("4: a tier whose estimated remainder is 30 s or less does not yield, and the named file leads the next", async () => {
    const F = "f/f.test.ts";
    const files: CatchUpFile[] = [
      ...SLOW.map((path) => ({ path, ms: 20_000, imports: ["src/s.ts"] })),
      { project: "f", path: F, ms: 1, imports: ["src/f.ts"] },
    ];
    const repo = catchUpRepo(files);
    const side = catchUpSide(repo, repo.main, { files, hostSlots: 8 });
    await side.scheduler.start();
    await side.scheduler.idle();
    const base = side.runner.runs.length;
    const gate = holdRuns(side.runner, isSlow);
    await side.edit("watch", "src/s.ts", "f.config.json");
    const tier = await heldRun(side, SLOW[0] ?? "", base);

    await side.scheduler.promote([ref(F, "f")], 60_000);
    await pause(SETTLE_MS);
    expect(tier.cancelled).toBe(false);
    expect(tier.endedAt).toBeNull();
    gate.stop();
    await side.scheduler.idle();

    const next = side.runner.runs[side.runner.runs.indexOf(tier) + 1];
    expect(next?.files.map((f) => f.path)).toEqual([F]);
    expect(tier.completed).toHaveLength(4);
  });
});
