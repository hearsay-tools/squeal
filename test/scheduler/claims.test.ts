import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Store } from "../../src/core/types/index.js";
import { claimRepo, fileName, side } from "./claims-fixture.js";

/*
 * Task 001-205, from research `shared-runs.md` (001-201): worktrees split a
 * baseline through derived claims. A claim on a key is another worktree's
 * `test_file_keys` row at it with `pending = 'running'`, whose daemon
 * heartbeats; a queued file another worktree's result could stand for waits
 * while one holds (D5 step 4, D8 as amended). Tests 1, 4, 5, 6, 8 and 9 of
 * the research's ten; `claims-expiry.test.ts` has 2, 3 and 10, and
 * `test/daemon/claims-restart.test.ts` has 7.
 */

const COUNT = 20;
const all = Array.from({ length: COUNT }, (_, i) => fileName(i));
const F0 = fileName(0);

describe("claims: two worktrees on one store (task 001-205)", () => {
  it("1. runs each of 20 shared keys once, and both worktrees end current", async () => {
    const { main, other } = claimRepo(COUNT);
    const a = side(main, { count: COUNT, backlogTierSize: 10, runMs: 100 });
    const b = side(other, { count: COUNT, backlogTierSize: 10, runMs: 100 });
    await Promise.all([a.scheduler.start(), b.scheduler.start()]);
    await Promise.all([a.scheduler.idle(), b.scheduler.idle()]);
    for (const path of all) expect(a.runner.ran(path) + b.runner.ran(path)).toBe(1);
    expect(a.passing()).toBe(COUNT);
    expect(b.passing()).toBe(COUNT);
    expect(a.store.checkpoints.lastCompleted(a.worktreeId)?.end).toBe("completed");
    expect(b.store.checkpoints.lastCompleted(b.worktreeId)?.end).toBe("completed");
  });

  it("4. an edit that re-keys a file to a key another worktree runs runs it at once", async () => {
    const { main, other } = claimRepo(4);
    appendFileSync(join(main, F0), "// x\n");
    const b = side(other, { count: 4 });
    await b.scheduler.start();
    await b.scheduler.idle();
    const a = side(main, { count: 4 });
    a.runner.hold();
    await a.scheduler.start();
    await expect.poll(() => a.phase(F0)).toBe("running");

    appendFileSync(join(other, F0), "// x\n");
    await b.batch(F0);
    expect(b.keyOf(F0)).toBe(a.keyOf(F0));
    await expect.poll(() => b.runner.ran(F0)).toBe(2);
    expect(a.runner.active).toBe(1);
  });

  it("5. run --all --force in both worktrees runs every file in both", async () => {
    const { main, other } = claimRepo(6);
    const a = side(main, { count: 6 });
    const b = side(other, { count: 6 });
    await Promise.all([a.scheduler.start(), b.scheduler.start()]);
    await Promise.all([a.scheduler.idle(), b.scheduler.idle()]);
    const fileRuns = (s: typeof a) => s.runner.runs.flat().length;
    const [ranA, ranB] = [fileRuns(a), fileRuns(b)];
    await Promise.all([
      a.scheduler.requestFullSuite({ force: true }),
      b.scheduler.requestFullSuite({ force: true }),
    ]);
    await Promise.all([a.scheduler.idle(), b.scheduler.idle()]);
    expect(fileRuns(a) - ranA).toBe(6);
    expect(fileRuns(b) - ranB).toBe(6);
  });

  it.each([
    ["no claim", false],
    ["a claim on it", true],
  ])(
    "6. another worktree's stored fail at a key runs here (001-170), with %s",
    async (_, claimed) => {
      const { main, other } = claimRepo(4);
      const a = side(main, { count: 4, rerunCap: 0 });
      a.runner.failing.add(F0);
      await a.scheduler.start();
      await a.scheduler.idle();
      if (claimed) {
        a.runner.hold();
        await a.scheduler.requestFullSuite({ force: true });
        await expect.poll(() => a.phase(F0)).toBe("running");
      }
      const b = side(other, { count: 4 });
      await b.scheduler.start();
      await expect.poll(() => b.runner.ran(F0)).toBe(1);
      // The other files take a's results instead, at once or once a's tier records.
      expect(b.runner.runs.flat().map((f) => f.path)).toEqual([F0]);
    },
  );

  it("8. a file re-keyed during its run is queued at the new key, not running", async () => {
    const { main } = claimRepo(2);
    const a = side(main, { count: 2, tierSize: 2 });
    a.runner.hold();
    await a.scheduler.start();
    await expect.poll(() => a.phase(F0)).toBe("running");
    const ran = a.keyOf(F0);
    appendFileSync(join(main, F0), "// edited\n");
    await a.batch(F0);
    expect(a.keyOf(F0)).not.toBe(ran);
    expect(a.phase(F0)).toBe("queued");
    expect(a.phase(fileName(1))).toBe("running");
  });

  it("9. a key another worktree claimed between selection and the claim stays queued", async () => {
    const { main, other } = claimRepo(COUNT);
    const a = side(main, { count: COUNT });
    let inTransaction = 0;
    let claimedBy: Store | null = null;
    // In the transaction that would claim b's tier, a's rows already run every key, as when
    // a's own transaction committed just after b's selection read them free.
    const wrap = (store: Store): Store =>
      new Proxy(store, {
        get(target, prop, receiver) {
          if (prop === "transaction") {
            return <T>(fn: () => T): T =>
              target.transaction(() => {
                inTransaction += 1;
                try {
                  return fn();
                } finally {
                  inTransaction -= 1;
                }
              });
          }
          if (prop !== "testFileKeys") return Reflect.get(target, prop, receiver);
          return {
            ...target.testFileKeys,
            claimed: (...args: Parameters<Store["testFileKeys"]["claimed"]>) => {
              if (inTransaction > 0 && claimedBy === null) {
                claimedBy = target;
                const rows = target.testFileKeys.list(args[0]).map((row) => ({
                  ...row,
                  worktreeId: a.worktreeId,
                  pending: "running" as const,
                }));
                target.testFileKeys.upsertMany(rows);
              }
              return target.testFileKeys.claimed(...args);
            },
          };
        },
      });
    const b = side(other, { count: COUNT, backlogTierSize: COUNT, wrap });
    await b.scheduler.start();
    await expect.poll(() => claimedBy).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(b.runner.runs).toEqual([]);
    expect(all.map((path) => b.phase(path))).toEqual(all.map(() => "queued"));

    // a's tier ends with nothing stored: its claims end, and b runs each key once.
    a.store.testFileKeys.upsertMany(
      a.store.testFileKeys.list(a.worktreeId).map((row) => ({ ...row, pending: null })),
    );
    await b.scheduler.idle();
    for (const path of all) expect(b.runner.ran(path)).toBe(1);
  });
});
