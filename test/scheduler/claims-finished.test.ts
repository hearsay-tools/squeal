import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CheckKey, Store } from "../../src/core/types/index.js";
import { claimRepo, fileName, type Side, side } from "./claims-fixture.js";

/*
 * Review wave 13o, B1 (task 001-210), beside research test 9: another
 * worktree's tier runs a key and records it between this worktree's
 * selection, whose lookup missed and whose claim check found the key free,
 * and its start. The start looks the key up again in its transaction: the
 * result stands, and the key does not run twice.
 */

const COUNT = 4;
const all = Array.from({ length: COUNT }, (_, i) => fileName(i));

/** `a`'s finished tier of `path` at `key`, in one transaction of its own connection: run, result, row. */
function recordIn(a: Side, path: string, key: CheckKey): void {
  const { store, worktreeId } = a;
  const at = Date.now();
  const runId = randomUUID();
  const testFile = { project: "", path };
  store.transaction(() => {
    store.runs.start({
      id: runId,
      worktreeId,
      revision: 1,
      testFiles: [testFile],
      checkpointId: null,
      logDir: `/tmp/squeal-001-210-${runId}`,
      startedAt: at,
    });
    store.results.putMany([
      {
        check: { kind: "test", project: "", testPath: path, fullName: "passes" },
        key,
        outcome: "pass",
        durationMs: 1,
        location: null,
        fingerprint: null,
        summary: null,
        errors: [],
        provenance: { worktreeId, revision: 1, commit: "0".repeat(40), dirty: false, runId, recordedAt: at },
      },
    ]);
    store.runs.finish(runId, "completed", at);
    store.testFileKeys.upsertMany([{ worktreeId, testFile, key, revision: 1, pending: null }]);
  });
}

/**
 * `b`'s store, where `a` records each key of `finishing` as `b`'s selection
 * checks its claim, outside a transaction, after its lookup missed; `starts`
 * counts the run rows `b` opens.
 */
function racing(a: () => Side, finishing: ReadonlySet<string>) {
  let inTransaction = 0;
  const recorded: string[] = [];
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
            const path = target.testFileKeys
              .list(worktreeId)
              .find((row) => row.key === key)?.testFile.path;
            if (inTransaction === 0 && path !== undefined && finishing.has(path)) {
              if (!recorded.includes(path)) {
                recorded.push(path);
                recordIn(a(), path, key);
              }
            }
            return target.testFileKeys.claimed(...args);
          },
        };
      },
    });
  return { wrap, recorded, counts };
}

describe("claims: a key recorded between selection and start (review wave 13o, B1)", { timeout: 30_000 }, () => {
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
});
