import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { DEFAULT_POLICY, type Policy, type Store } from "../../src/core/types/index.js";
import { claimRepo, fileName, recordedBy, type Side, side } from "./claims-fixture.js";

/*
 * Review wave 13o, B1 (task 001-210), beside research test 9: another
 * worktree's tier runs a key and records it between this worktree's
 * selection, whose lookup missed and whose claim check found the key free,
 * and its start. The start looks the key up again in its transaction: the
 * result stands, and the key does not run twice.
 */

const COUNT = 4;
const all = Array.from({ length: COUNT }, (_, i) => fileName(i));
const ARTIFACT = "dist/app.js";

/**
 * `b`'s store, where `a` records each key of `finishing` as `b`'s selection
 * checks its claim, outside a transaction, after its lookup missed: at the
 * key's `at`th such check, as a slow file's candidates check it before its
 * pick does. `starts` counts the run rows `b` opens.
 */
function racing(a: () => Side, finishing: ReadonlySet<string>, at = 1) {
  let inTransaction = 0;
  const recorded: string[] = [];
  const checks = new Map<string, number>();
  const counts = { starts: 0 };
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
        if (prop === "runs") {
          return {
            ...target.runs,
            start: (...args: Parameters<Store["runs"]["start"]>) => {
              counts.starts += 1;
              return target.runs.start(...args);
            },
          };
        }
        if (prop !== "testFileKeys") return Reflect.get(target, prop, receiver);
        return {
          ...target.testFileKeys,
          claimed: (...args: Parameters<Store["testFileKeys"]["claimed"]>) => {
            const [worktreeId, key] = args;
            const path = target.testFileKeys.list(worktreeId).find((row) => row.key === key)
              ?.testFile.path;
            if (inTransaction === 0 && path !== undefined && finishing.has(path)) {
              checks.set(path, (checks.get(path) ?? 0) + 1);
              if (checks.get(path) === at) {
                recorded.push(path);
                const { store, worktreeId } = a();
                store.transaction(() => recordedBy(store, worktreeId, path, key));
              }
            }
            return target.testFileKeys.claimed(...args);
          },
        };
      },
    });
  return { wrap, recorded, counts };
}

describe("claims: a key recorded between selection and start (review wave 13o, B1)", {
  timeout: 30_000,
}, () => {
  it("every selected file settles in the start: no run, no run row, the checkpoint completes", async () => {
    const { main, other } = claimRepo(COUNT);
    const a = side(main, { count: COUNT });
    const race = racing(() => a, new Set(all));
    const b = side(other, { count: COUNT, wrap: race.wrap });
    await b.scheduler.start();
    await b.scheduler.idle();
    expect(race.recorded).toEqual(all);
    expect(b.runner.runs).toEqual([]);
    expect(race.counts.starts).toBe(0);
    expect(b.passing()).toBe(COUNT);
    expect(all.map((path) => b.phase(path))).toEqual(all.map(() => null));
    expect(b.store.checkpoints.lastCompleted(b.worktreeId)?.end).toBe("completed");
  });

  it("the files recorded meanwhile settle and the others run here, once each", async () => {
    const { main, other } = claimRepo(COUNT);
    const a = side(main, { count: COUNT });
    const finishing = new Set(all.slice(0, 2));
    const race = racing(() => a, finishing);
    const b = side(other, { count: COUNT, wrap: race.wrap });
    await b.scheduler.start();
    await b.scheduler.idle();
    expect(race.recorded).toEqual([...finishing]);
    expect(b.runner.runs.map((files) => files.map((f) => f.path))).toEqual([all.slice(2)]);
    expect(race.counts.starts).toBe(1);
    expect(b.passing()).toBe(COUNT);
    expect(b.store.checkpoints.lastCompleted(b.worktreeId)?.end).toBe("completed");
  });

  it("every slow pick settles in the start: the pump plans again and the next slow file runs", async () => {
    const slow = all.slice(0, 3);
    const { main, other } = claimRepo(3, { [ARTIFACT]: "app\n" });
    const slotDir = mkdtempSync(join(tmpdir(), "squeal-001-210-slot-"));
    onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
    const policy: Partial<Policy> = {
      slow: { ...DEFAULT_POLICY.slow, include: slow, maxParallel: 2 },
      inputs: Object.fromEntries(slow.map((path) => [path, [ARTIFACT]])),
    };
    const a = side(main, { count: 3, policy });
    const finishing = new Set(slow.slice(0, 2));
    const race = racing(() => a, finishing, 2);
    const slowOptions = { slotDir, recheckMs: 50, load: () => [0], cpus: () => 1 };
    const b = side(other, { count: 3, policy, slow: slowOptions, wrap: race.wrap });
    await b.scheduler.start();
    await expect.poll(() => b.passing(), { timeout: 10_000 }).toBe(3);
    expect(race.recorded).toEqual([...finishing]);
    expect(b.runner.runs.map((files) => files.map((f) => f.path))).toEqual([[slow[2]]]);
    expect(race.counts.starts).toBe(1);
  });
});
