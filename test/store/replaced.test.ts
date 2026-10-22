import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { storePaths } from "../../src/core/store/index.js";
import {
  REPLACED_KEPT,
  REPLACED_META_KEY,
  REPLACED_PER_CHECK,
} from "../../src/core/store/repos/replaced.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { CheckId, Store } from "../../src/core/types/index.js";
import { DAY_MS, fakeCommonDir, open, result, testCheck, worktree } from "./helpers.js";

/*
 * 011-64 R3 tests 2 and 3 (row 011-77, gh-54): what a replaced failure keeps,
 * its caps, and what prune keeps while it is kept and drops once it expires.
 */

const NOW = 100 * DAY_MS;
const HOUR_MS = 60 * 60 * 1000;

const STACK = ["AssertionError: expected 1 to be 2", "    at src/a.test.ts:3:5"].join("\n");

function fixture() {
  const commonDir = fakeCommonDir();
  const store = open(commonDir);
  store.worktrees.upsert(worktree("main", dirname(commonDir), { isMain: true, commonDir }));
  return { store, runsDir: storePaths(commonDir).runsDir };
}

function startRun(store: Store, runsDir: string, id: string, at: number): string {
  const logDir = join(runsDir, id);
  mkdirSync(logDir, { recursive: true });
  store.runs.start({
    id,
    worktreeId: "main",
    revision: 1,
    testFiles: [],
    checkpointId: null,
    logDir,
    startedAt: at,
  });
  store.runs.finish(id, "completed", at);
  return logDir;
}

/** `check` fails at `key` in run `fail-<n>`, recorded `at`, then passes there in `pass-<n>` a minute later. */
function flip(store: Store, check: CheckId, key: string, n: number, at: number) {
  const failed = result(check, key, {
    outcome: "fail",
    worktreeId: "main",
    recordedAt: at,
    runId: `fail-${n}`,
    errors: [
      {
        name: "AssertionError",
        message: `expected ${n} to be 2`,
        stack: STACK,
        location: null,
        diff: null,
      },
    ],
  });
  store.results.putMany([{ ...failed, summary: `expected ${n} to be 2` }]);
  store.transaction(() => {
    const failing = store.failures.failingAt(key);
    const pass = result(check, key, {
      worktreeId: "main",
      recordedAt: at + 60_000,
      runId: `pass-${n}`,
    });
    store.results.putMany([pass]);
    store.failures.keepReplaced(failing, [pass], () => 1.5);
  });
}

const runsOf = (store: Store) => store.failures.replaced().map((e) => e.provenance.runId);

/** `count` more kept entries after the ones kept, each of its own check, as many flips would leave. */
function seedKept(store: Store, count: number, from = 0): void {
  const kept = store.failures.replaced();
  const [model] = kept;
  if (model === undefined) throw new Error("flip one first");
  const more = Array.from({ length: count }, (_, i) => ({
    ...model,
    check: testCheck(`c${from + i}`),
    key: `k-${from + i}`,
    provenance: { ...model.provenance, runId: `seeded-${from + i}` },
  }));
  store.meta.set(REPLACED_META_KEY, JSON.stringify([...kept, ...more]));
}

describe("replaced failures (011-77)", () => {
  it("keeps every flip, at another key and again at the same one; caps 4 per check and 1,024 in all", () => {
    const { store } = fixture();
    const a = testCheck("a");
    flip(store, a, "k1", 1, NOW);
    flip(store, a, "k2", 2, NOW + 1);
    flip(store, a, "k1", 3, NOW + 2);
    flip(store, a, "k1", 4, NOW + 3);
    expect(runsOf(store)).toEqual(["fail-1", "fail-2", "fail-3", "fail-4"]);
    expect(store.failures.replaced()[0]).toMatchObject({
      check: a,
      key: "k1",
      provenance: { runId: "fail-1", worktreeId: "main", recordedAt: NOW, revision: 4 },
      summary: "expected 1 to be 2",
      loadPerCpu: 1.5,
      replacedBy: { runId: "pass-1", worktreeId: "main", recordedAt: NOW + 60_000 },
    });

    // A 5th of one check drops that check's oldest.
    flip(store, a, "k2", 5, NOW + 4);
    expect(runsOf(store)).toEqual(["fail-2", "fail-3", "fail-4", "fail-5"]);
    expect(REPLACED_PER_CHECK).toBe(4);

    // The 1,025th in all drops the oldest of all.
    seedKept(store, REPLACED_KEPT - 4);
    expect(runsOf(store)).toHaveLength(REPLACED_KEPT);
    expect(runsOf(store)[0]).toBe("fail-2");
    flip(store, testCheck("last"), "k-last", 9_999, NOW + 5_000);
    expect(runsOf(store)).toHaveLength(REPLACED_KEPT);
    expect(runsOf(store)[0]).toBe("fail-3");
    expect(runsOf(store).at(-1)).toBe("fail-9999");
  });

  it("keeps nothing for a fail replaced by a fail or a skip, or a pass at another key", () => {
    const { store } = fixture();
    const a = testCheck("a");
    store.results.putMany([result(a, "k1", { outcome: "fail", runId: "fail-1" })]);
    store.transaction(() => {
      const failing = store.failures.failingAt("k1");
      expect(failing).toHaveLength(1);
      expect(failing[0]?.failureId).toEqual(expect.any(String));
      const again = result(a, "k1", { outcome: "fail", runId: "fail-2" });
      const skip = result(a, "k1", { outcome: "skip", runId: "skip-1" });
      const elsewhere = result(a, "k2", { runId: "pass-1" });
      expect(store.failures.keepReplaced(failing, [again], () => null)).toBe(0);
      expect(store.failures.keepReplaced(failing, [skip], () => null)).toBe(0);
      expect(store.failures.keepReplaced(failing, [elsewhere], () => null)).toBe(0);
    });
    expect(store.failures.replaced()).toEqual([]);
    expect(store.meta.get(REPLACED_META_KEY)).toBeNull();
  });

  it("an hour later prune keeps the entry's text, run and log; 8 days later it drops the entry, then them", () => {
    const { store, runsDir } = fixture();
    const a = testCheck("a");
    const failLog = startRun(store, runsDir, "fail-1", NOW);
    startRun(store, runsDir, "pass-1", NOW + 60_000);
    flip(store, a, "k1", 1, NOW);
    const [entry] = store.failures.replaced();
    const textId = entry?.failureId as string;
    expect(store.failures.text(textId)?.errors[0]?.stack).toBe(STACK);

    store.prune({ now: NOW + HOUR_MS, retentionDays: 7, maxSizeMb: null });
    expect(store.failures.replaced()).toHaveLength(1);
    expect(store.failures.text(textId)).not.toBeNull();
    expect(store.runs.get("fail-1")).not.toBeNull();
    expect(existsSync(failLog)).toBe(true);

    store.prune({ now: NOW + 8 * DAY_MS, retentionDays: 7, maxSizeMb: null });
    expect(store.failures.replaced()).toEqual([]);
    expect(store.meta.get(REPLACED_META_KEY)).toBeNull();
    expect(store.failures.text(textId)).toBeNull();
    expect(store.runs.get("fail-1")).toBeNull();
    expect(existsSync(failLog)).toBe(false);
  });

  it("before the cutoff, prune keeps its text under the size cap, and its run once its worktree is gone", () => {
    const { store, runsDir } = fixture();
    store.worktrees.upsert(worktree("gone", "/nowhere/gone"));
    startRun(store, runsDir, "fail-1", NOW);
    connectionOf(store).run("UPDATE runs SET worktree_id = 'gone' WHERE id = 'fail-1'");
    flip(store, testCheck("a"), "k1", 1, NOW);
    const textId = store.failures.replaced()[0]?.failureId as string;
    store.prune({ now: NOW + DAY_MS, retentionDays: 7, maxSizeMb: 0 });
    expect(store.worktrees.list().map((w) => w.id)).toEqual(["main"]);
    expect(store.results.byKey("k1", 0)).toEqual([]);
    expect(store.failures.text(textId)).not.toBeNull();
    expect(store.runs.get("fail-1")).not.toBeNull();
  });

  it("reads past a damaged meta row and a damaged entry, and prune still runs", () => {
    const { store } = fixture();
    flip(store, testCheck("a"), "k1", 1, NOW);
    const kept = JSON.parse(store.meta.get(REPLACED_META_KEY) as string) as unknown[];
    store.meta.set(REPLACED_META_KEY, JSON.stringify([{ check: 1 }, ...kept]));
    expect(runsOf(store)).toEqual(["fail-1"]);
    store.meta.set(REPLACED_META_KEY, "{not json");
    expect(store.failures.replaced()).toEqual([]);
    expect(() => store.prune({ now: NOW, retentionDays: 7, maxSizeMb: null })).not.toThrow();
  });

  it("rewrites the kept list 8 times in one commit at 1,024 kept entries within a bound", () => {
    const { store } = fixture();
    flip(store, testCheck("first"), "k-first", 0, NOW);
    seedKept(store, REPLACED_KEPT - 1);
    const start = performance.now();
    store.transaction(() => {
      for (let i = 0; i < 8; i++)
        flip(store, testCheck(`t${i}`), `k-t${i}`, 5_000 + i, NOW + 5_000 + i);
    });
    const ms = performance.now() - start;
    expect(runsOf(store)).toHaveLength(REPLACED_KEPT);
    // About 1 MB parsed and written per file that flips; measured near 60 ms on an idle host.
    expect(ms).toBeLessThan(2_000);
  });
});
