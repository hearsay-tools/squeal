import { describe, expect, it } from "vitest";
import { claimRepo, fileName, side } from "./claims-fixture.js";

/*
 * Task 001-205, D5 step 5 as amended: while other live daemons have a
 * worktree's queued keys pending too, its backlog tier takes the queued files
 * divided by those daemons and itself, rounded up, at least
 * `runner.tierSize` and at most `runner.backlogTierSize` (research
 * `shared-runs.md`, granularity). And the research's finding 5 in process:
 * four worktrees on one commit run each key once, split between them.
 */

describe("claims: a backlog split between daemons (task 001-205)", { timeout: 60_000 }, () => {
  it("a backlog tier beside one other daemon with the same keys takes half the queue", async () => {
    const { main, other } = claimRepo(20);
    const b = side(other, { count: 20, tierSize: 1, backlogTierSize: 1 });
    b.runner.hold();
    await b.scheduler.start();
    await expect.poll(() => b.runner.active).toBe(1);

    const a = side(main, { count: 20, tierSize: 4, backlogTierSize: 20 });
    await a.scheduler.start();
    await expect.poll(() => a.runner.runs.length).toBeGreaterThan(0);
    expect(a.runner.runs[0]).toHaveLength(10);
    expect(a.runner.runs[0]?.map((f) => f.path)).not.toContain(b.runner.runs[0]?.[0]?.path);
  });

  it("alone, a backlog tier takes up to runner.backlogTierSize", async () => {
    const { main } = claimRepo(20);
    const a = side(main, { count: 20, tierSize: 4, backlogTierSize: 20 });
    await a.scheduler.start();
    await a.scheduler.idle();
    expect(a.runner.runs[0]).toHaveLength(20);
  });

  it("finding 5: four worktrees starting together run each of 120 keys once", async () => {
    const count = 120;
    const { main, others } = claimRepo(count, {}, 3);
    const sides = [main, ...others].map((root) =>
      side(root, { count, tierSize: 4, backlogTierSize: 200, runMs: 300 }),
    );
    await Promise.all(sides.map((s) => s.scheduler.start()));
    await Promise.all(sides.map((s) => s.scheduler.idle()));
    for (let i = 0; i < count; i++) {
      const path = fileName(i);
      expect(sides.reduce((runs, s) => runs + s.runner.ran(path), 0)).toBe(1);
    }
    for (const s of sides) expect(s.passing()).toBe(count);
  });
});
