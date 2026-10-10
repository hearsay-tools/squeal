import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { acquireSlowSlot, type SlowSlot } from "../../src/core/slow/index.js";
import { DEFAULT_POLICY, type Policy, type Store } from "../../src/core/types/index.js";
import { claimRepo, fileName, recordedBy, side } from "./claims-fixture.js";

/*
 * Review wave 13o, B2 (task 001-210): a slow tier holds one permit per file
 * it runs (spec 004 D2). `b` takes two permits for two slow picks; in its
 * start transaction, between the two picks' checks, `a` claims or records
 * the second one's key. `b` runs the first alone on one permit, and a third
 * owner of the shared slot gets the spare permit while it runs.
 */

const F0 = fileName(0);
const F1 = fileName(1);
const ARTIFACT = "dist/app.js";
const MAX_PARALLEL = 3;

/** `b`'s store: at its first claim check inside a transaction, `F0`'s in the start, `a` takes `F1`'s key. */
function startRace(own: string, a: string, takes: "claims" | "records") {
  let inTransaction = 0;
  let done = false;
  return (store: Store): Store =>
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
            if (inTransaction > 0 && !done) {
              done = true;
              const row = target.testFileKeys.list(own).find((r) => r.testFile.path === F1);
              const key = row?.key ?? null;
              if (row === undefined || key === null) throw new Error(`${F1} has no key`);
              if (takes === "records") recordedBy(target, a, F1, key);
              else {
                const claim = { worktreeId: a, testFile: row.testFile, key, revision: 1 };
                target.testFileKeys.upsertMany([{ ...claim, pending: "running" }]);
              }
            }
            return target.testFileKeys.claimed(...args);
          },
        };
      },
    });
}

describe("a partly started slow tier (review wave 13o, B2)", { timeout: 30_000 }, () => {
  it.each(["claims", "records"] as const)(
    "another worktree %s a pick before the start: one permit per file run, the spare to a third owner",
    async (takes) => {
      const { main, other } = claimRepo(2, { [ARTIFACT]: "app\n" });
      const slotDir = mkdtempSync(join(tmpdir(), "squeal-001-210-slot-"));
      const held: SlowSlot[] = [];
      onTestFinished(() => {
        for (const slot of held) slot.release();
        rmSync(slotDir, { recursive: true, force: true });
      });
      const take = (worktreeId: string) => {
        const slot = acquireSlowSlot({
          dir: slotDir,
          owner: { pid: process.pid, worktreeId },
          permits: MAX_PARALLEL,
        });
        if (slot !== null) held.push(slot);
        return slot;
      };
      const policy: Partial<Policy> = {
        slow: { ...DEFAULT_POLICY.slow, include: [F0, F1], maxParallel: MAX_PARALLEL },
        inputs: { [F0]: [ARTIFACT], [F1]: [ARTIFACT] },
      };
      const a = side(main, { count: 2, policy });
      // `a`'s run of `F1` holds a permit; `b` gets the other two.
      expect(take(a.worktreeId)).not.toBeNull();
      const b = side(other, {
        count: 2,
        policy,
        slow: { slotDir, recheckMs: 50, load: () => [0], cpus: () => 1 },
        wrap: startRace(worktreeIdFor(other), a.worktreeId, takes),
      });
      b.runner.hold();
      await b.scheduler.start();
      await expect.poll(() => b.runner.active).toBe(1);
      expect(b.runner.runs.map((files) => files.map((f) => f.path))).toEqual([[F0]]);
      expect(b.phase(F1)).toBe(takes === "claims" ? "queued" : null);

      expect(take("c")).not.toBeNull();
      expect(b.runner.active).toBe(1);
      b.runner.release();
      if (takes === "records") {
        await b.scheduler.idle();
        expect(b.runner.ran(F1)).toBe(0);
        expect(b.passing()).toBe(2);
      }
    },
  );
});
