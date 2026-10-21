import { describe, expect, it } from "vitest";
import {
  type CatchUpFile,
  catchUpRepo,
  catchUpSide,
} from "../../../../../../test/scheduler/catch-up-fixture.js";

/*
 * Throwaway probe for gh-63 (research/issue-63.md). Not product code, not in
 * the suite. One fast regression file and four slow files in one lane. An
 * edit (revision 2) runs the regression first, then the four slow files as
 * an edit's tier. While that tier runs, a second edit (revision 3, "the
 * fix") re-keys the regression file, and in case A the four slow files too,
 * so the tier in flight is superseded. A named wait promotes the regression
 * file. The probe records whether the tier in flight is cancelled and when
 * the regression's revision-3 run starts against the tier's end. Run with
 * `npx vitest run -c docs/specifications/011-core/research/probes/issue-63/vitest.config.ts`.
 */
const SLOW_REAL_MS = 3_000;
const REG = "test/reg.test.ts";

function files(slowImport: string): CatchUpFile[] {
  return [
    { path: REG, ms: 1, realMs: 0, imports: ["src/waits.ts", "src/shared.ts"] },
    ...[1, 2, 3, 4].map((i) => ({
      path: `test/slow${i}.test.ts`,
      ms: 100_000,
      realMs: SLOW_REAL_MS,
      imports: [slowImport],
    })),
  ];
}

async function scenario(label: string, fixEdits: string, slowImport: string, cancels = true) {
  const all = files(slowImport);
  const repo = catchUpRepo(all);
  const side = catchUpSide(repo, repo.main, { files: all, hostSlots: 8, cancels });
  await side.scheduler.start();
  await side.scheduler.idle();
  const base = side.runner.runs.length;
  // Revision 2: the regression's source changes; every file importing it re-runs.
  await side.edit("watch", "src/waits.ts", "src/shared.ts");
  await expect
    .poll(() => side.runner.runs.slice(base).some((r) => r.files.some((f) => f.path.includes("slow"))))
    .toBe(true);
  const slowRun = side.runner.runs.slice(base).find((r) => r.files.some((f) => f.path.includes("slow")));
  const regRev2 = side.runner.runs.slice(base).find((r) => r.files.some((f) => f.path === REG));
  // Revision 3: the fix, while the slow tier is in flight.
  const fixAt = performance.now();
  await side.edit("watch", fixEdits);
  await side.scheduler.promote([{ project: "", path: REG }], 60_000);
  await side.scheduler.idle();
  const after = side.runner.runs.filter((r) => r.startedAt >= fixAt);
  const regRev3 = after.find((r) => r.files.some((f) => f.path === REG));
  const slowAgain = after.filter((r) => r.files.some((f) => f.path.includes("slow")));
  const t = (x: number | null | undefined) => (x == null ? "n/a" : `${Math.round(x - fixAt)}ms`);
  const line =
    `${label}: rev2 tiers=[${side.runner.runs
      .slice(base)
      .filter((r) => r.startedAt < fixAt)
      .map((r) => r.files.map((f) => f.path.replace(/^test\/|\.test\.ts$/g, "")).join("+"))
      .join(" | ")}]` +
    ` regRev2InOwnTier=${regRev2?.files.length === 1}` +
    ` slowTierSize=${slowRun?.files.length} slowCancelled=${slowRun?.cancelled}` +
    ` slowCompleted=${slowRun?.completed.length}` +
    ` slowEnd=${t(slowRun?.endedAt)} regRev3Start=${t(regRev3?.startedAt)}` +
    ` regRev3Tier=${regRev3?.files.length}` +
    ` slowRerunTiers=${slowAgain.length} slowRerunFiles=${slowAgain.reduce((n, r) => n + r.files.length, 0)}` +
    ` allCurrent=${all.every((f) => side.current(f.path))}`;
  console.log(line);
  return { slowRun, regRev3 };
}

describe("gh-63 probe: a named wait behind a superseded edit tier", { timeout: 60_000 }, () => {
  it("A: the fix re-keys the running slow tier too (superseded tier)", async () => {
    const { slowRun, regRev3 } = await scenario("A superseded", "src/waits.ts", "src/waits.ts");
    expect(slowRun?.cancelled).toBe(false);
    expect(regRev3?.startedAt ?? 0).toBeGreaterThanOrEqual(slowRun?.endedAt ?? Infinity);
  });

  it("B: the fix re-keys only the regression file (tier not superseded)", async () => {
    const { slowRun, regRev3 } = await scenario("B not superseded", REG, "src/shared.ts");
    expect(slowRun?.cancelled).toBe(false);
    expect(regRev3?.startedAt ?? 0).toBeGreaterThanOrEqual(slowRun?.endedAt ?? Infinity);
  });
});
