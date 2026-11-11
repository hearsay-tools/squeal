import { describe, expect, it } from "vitest";
import { B, heldBatch, P, paths, X } from "./batch-fixture.js";

/*
 * Spec 021 D12 (row 021-14; the coordinator, request bbd49224): only
 * background tiers may go to a remote runner host. `executeTier` marks a
 * backlog tier and the backlog's turn `RunOptions.background`; an edit's
 * tier and a named wait's batch tier, which someone waits for, carry no
 * mark and so stay local. The setup is `batch-fixture.ts`.
 */
describe("which runs are background (spec 021 D12)", { timeout: 120_000 }, () => {
  it("marks the backlog's tiers, and neither an edit's tier nor a named wait's batch", async () => {
    const { side, gate, batch, after } = await heldBatch();
    gate.stop();
    await side.scheduler.idle();
    const runs = side.runner.runs;
    // The baseline ran X in the backlog; the edit's tier is X's last run before the batch.
    expect(runs.find((run) => paths(run).includes(X))?.background).toBe(true);
    const edit = runs.slice(0, after).findLast((run) => paths(run).includes(X));
    expect(edit?.workers).toBeUndefined();
    expect(edit?.background).toBe(false);
    expect(paths(batch).every((path) => P.includes(path))).toBe(true);
    expect(batch.background).toBe(false);
    const backlog = runs.slice(after).filter((run) => paths(run).every((path) => B.includes(path)));
    expect(backlog.length).toBeGreaterThan(0);
    expect(backlog.every((run) => run.background && run.workers !== undefined)).toBe(true);
  });
});
