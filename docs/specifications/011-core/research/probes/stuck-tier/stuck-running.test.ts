import { describe, expect, it } from "vitest";
import type { TestFileRef } from "../../src/core/types/index.js";
import { createRepo, openHarness, openRepoStore, ref, SLOW } from "./helpers.js";

/*
 * Probe for row 011-71 (research/stuck-tier.md), throwaway. Copied to
 * test/scheduler/ of a scratch clone at squeal--v0.1.238 and run there.
 *
 * A tier runs math.test.ts at key C. While it runs, an edit moves the file to
 * key B, which has a stored result: the lookup applies it (resultKey = B).
 * The tier then ends: `supersededIn(file, C)` holds by its second clause
 * (file.key B, resultKey B), so `recordTier` skips `setRunning(file, null)`
 * and runningKey stays C. An edit back to C makes `settle` see
 * key === runningKey: the file is `running` with no tier, never queued again.
 */
const MATH = ref("test/math.test.ts");
const A = "export const add = (a: number, b: number) => a + b;\n";
const B = "export const add = (a: number, b: number) => b + a;\n";
const C = "export const add = (a: number, b: number) => a + b + 0;\n";

describe("probe 011-71: a running phase outlives its tier", () => {
  it("leaves math.test.ts running with no tier after C, B (stored), C", SLOW, async () => {
    const { main, commonDir } = createRepo();
    const store = openRepoStore(commonDir);
    const h = await openHarness(main, store, commonDir, { tierSize: 4, backlogTierSize: 8 });
    await h.scheduler.start();
    await h.scheduler.idle();

    // Key B gets a stored result in this worktree, then the file goes back to A.
    h.write("src/math.ts", B);
    await h.batch("src/math.ts");
    await h.scheduler.idle();
    const keyB = h.keyOf(MATH.path);
    h.write("src/math.ts", A);
    await h.batch("src/math.ts");
    await h.scheduler.idle();

    // The tier at key C is held at its start until B's lookup is applied.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const runs: (readonly TestFileRef[])[] = [];
    h.gate.before = async (files) => {
      runs.push(files);
      if (runs.length !== 1) return;
      entered();
      await held;
    };
    h.write("src/math.ts", C);
    await h.batch("src/math.ts");
    await started;
    const keyC = h.keyOf(MATH.path);
    expect(runs[0]?.map((f) => f.path)).toContain(MATH.path);

    h.write("src/math.ts", B);
    await h.batch("src/math.ts");
    expect(h.keyOf(MATH.path)).toBe(keyB);
    release();
    await h.scheduler.idle();

    const before = runs.length;
    h.write("src/math.ts", C);
    await h.batch("src/math.ts");
    await h.scheduler.idle();
    expect(h.keyOf(MATH.path)).toBe(keyC);

    const row = store.testFileKeys.list(h.worktreeId, [MATH])[0];
    const ranAfter = runs.slice(before).some((files) => files.some((f) => f.path === MATH.path));
    // A `run --all` names the file too; it never completes.
    const checkpoint = await h.scheduler.requestFullSuite();
    await h.scheduler.idle();
    const ended = store.checkpoints.get(checkpoint.id);
    console.log(
      JSON.stringify({
        pending: row?.pending,
        rowKeyIsC: row?.key === keyC,
        ranAfter,
        checkpointCompletedAt: ended?.completedAt ?? null,
        busy: h.scheduler.busy(),
        owed: h.scheduler.owedWork(),
        // How the held tier at C ended: cancelled for the edit, or ran to its end.
        heldTierEnd: h.runner.runs.find((r) => r.files === runs[0])?.report.failure ?? "completed",
      }),
    );
    // The defect as 0.1.238 has it; the fix inverts these three.
    expect(row?.pending).toBe("running");
    expect(ranAfter).toBe(false);
    expect(ended?.completedAt ?? null).toBeNull();
  });
});
