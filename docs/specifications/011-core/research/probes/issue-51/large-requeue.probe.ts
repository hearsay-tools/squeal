import { describe, expect, it } from "vitest";
import {
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
  sources,
  testFiles,
} from "../../../../../../test/scheduler/catch-up-fixture.js";

/*
 * Throwaway probe for gh-51 (research/issue-51.md). Not product code, not in
 * the suite. A worktree of 303 test files over 12 sources, all run once; then
 * one revision edits the 12 sources (catch-up, 011-22), which re-keys all 303
 * like the reported merge. The first backlog tier is held in flight, and a
 * named wait promotes the file the order would run last. Run with
 * `npx vitest run -c docs/specifications/011-core/research/probes/issue-51/vitest.config.ts`.
 */
const COUNT = 303;
const SOURCES = sources(12);
// Durations spread 1 s to 31 s so the 120 s wall budget (C4 step 5) cuts several backlog tiers.
const FILES = testFiles(COUNT, SOURCES, (i) => 1_000 + i * 100);
const LAST = FILES.at(-1)?.path ?? "";

async function requeued(): Promise<{ side: CatchUpSide; before: number }> {
  const repo = catchUpRepo(FILES);
  const side = catchUpSide(repo, repo.main, { files: FILES, hostSlots: 8 });
  await side.scheduler.start();
  await side.scheduler.idle();
  side.runner.hold();
  const before = side.runner.runs.length;
  await side.edit("watch", ...SOURCES);
  await expect.poll(() => side.runner.active).toBe(1);
  return { side, before };
}

function report(label: string, side: CatchUpSide, before: number): number {
  const runs = side.runner.runs.slice(before).filter((r) => !(r.cancelled && r.completed.length === 0));
  const at = runs.findIndex((r) => r.files.some((f) => f.path === LAST));
  const ahead = runs.slice(0, at).reduce((n, r) => n + r.files.length, 0);
  console.log(
    `${label}: tiers=${runs.length} sizes=[${runs.map((r) => r.files.length).join(",")}]` +
      ` firstCancelled=${runs[0]?.cancelled} lastFileTier=${at} filesRunAhead=${ahead}`,
  );
  return at;
}

describe("gh-51 probe: a named wait behind a 303-file requeue", { timeout: 120_000 }, () => {
  it("without a promotion, the last file waits for the whole requeue", async () => {
    const { side, before } = await requeued();
    const first = side.runner.runs[before]?.files.length ?? 0;
    console.log(`no-promotion: tier in flight holds ${first} of ${COUNT}`);
    side.runner.release();
    await side.scheduler.idle();
    const at = report("no-promotion", side, before);
    expect(at).toBeGreaterThan(2);
  });

  it("with a promotion, the named file leads the tier after the one in flight", async () => {
    const { side, before } = await requeued();
    const inFlight = side.runner.runs[before]?.files.map((f) => f.path) ?? [];
    console.log(`promoted: tier in flight holds ${inFlight.length} of ${COUNT}; LAST in it: ${inFlight.includes(LAST)}`);
    await side.scheduler.promote([{ project: "", path: LAST }], 60_000);
    side.runner.release();
    await side.scheduler.idle();
    const at = report("promoted", side, before);
    const next = side.runner.runs.slice(before)[1];
    expect(side.runner.runs[before]?.cancelled).toBe(false);
    expect(at).toBe(1);
    expect(next?.files[0]?.path).toBe(LAST);
    expect(FILES.every((f) => side.current(f.path))).toBe(true);
  });
});
