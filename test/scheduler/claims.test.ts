import { describe, expect, it } from "vitest";
import { claimRepo, fileName, side } from "./claims-fixture.js";

/*
 * Task 001-205, from research `shared-runs.md` (001-201): worktrees split a
 * baseline through derived claims. A claim on a key is another worktree's
 * `test_file_keys` row at it with `pending = 'running'`, whose daemon
 * heartbeats; a queued file another worktree's result could stand for waits
 * while one holds (D5 step 4, D8 as amended). Tests 1, 4, 5, 6, 8 and 9 of
 * the research's ten; `claims-expiry.test.ts` has the rest.
 */

const COUNT = 20;
const all = Array.from({ length: COUNT }, (_, i) => fileName(i));

describe("claims: two worktrees on one store (task 001-205)", () => {
  it("1. runs each of 20 shared keys once, and both worktrees end current", async () => {
    const { main, other, store } = claimRepo(COUNT);
    const a = side(store, main, { count: COUNT, tierSize: 4, backlogTierSize: 10, runMs: 100 });
    const b = side(store, other, { count: COUNT, tierSize: 4, backlogTierSize: 10, runMs: 100 });
    await Promise.all([a.scheduler.start(), b.scheduler.start()]);
    await Promise.all([a.scheduler.idle(), b.scheduler.idle()]);
    for (const path of all) expect(a.runner.ran(path) + b.runner.ran(path)).toBe(1);
    expect(a.passing()).toBe(COUNT);
    expect(b.passing()).toBe(COUNT);
    expect(store.checkpoints.lastCompleted(b.worktreeId)?.end).toBe("completed");
    expect(store.checkpoints.lastCompleted(a.worktreeId)?.end).toBe("completed");
  });
});
