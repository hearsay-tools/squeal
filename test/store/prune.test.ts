import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { storePaths } from "../../src/core/store/index.js";
import type { CheckError, Store } from "../../src/core/types/index.js";
import { DAY_MS, fakeCommonDir, open, result, tempDir, testCheck, worktree } from "./helpers.js";

const NOW = 100 * DAY_MS;
const ago = (days: number) => NOW - days * DAY_MS;

interface Fixture {
  store: Store;
  commonDir: string;
  main: string;
  linked: string;
  removed: string;
}

/** Main worktree with a `.git` dir, a linked one with a `.git` file, one whose root is gone. */
function fixture(): Fixture {
  const commonDir = fakeCommonDir();
  const store = open(commonDir);
  const linkedRoot = tempDir();
  writeFileSync(join(linkedRoot, ".git"), `gitdir: ${commonDir}/worktrees/linked\n`);
  const removedRoot = tempDir();
  writeFileSync(join(removedRoot, ".git"), `gitdir: ${commonDir}/worktrees/removed\n`);
  store.worktrees.upsert(worktree("main", dirname(commonDir), { isMain: true, commonDir }));
  store.worktrees.upsert(worktree("linked", linkedRoot, { commonDir }));
  store.worktrees.upsert(worktree("removed", removedRoot, { commonDir }));
  rmSync(removedRoot, { recursive: true });
  return { store, commonDir, main: "main", linked: "linked", removed: "removed" };
}

function currentKey(store: Store, worktreeId: string, path: string, key: string): void {
  store.testFileKeys.upsertMany([
    { worktreeId, testFile: { project: "", path }, key, revision: 1, pending: null },
  ]);
}

function keys(store: Store, candidates: readonly string[]): string[] {
  return candidates.filter((key) => store.results.byKey(key).length > 0);
}

describe("prune (spec 001 D8)", () => {
  it("keeps current keys, the newest main result per check and recent results; drops the rest", () => {
    const { store, commonDir } = fixture();
    const runsDir = storePaths(commonDir).runsDir;

    // Current in the live linked worktree: kept although old and produced by a removed worktree.
    currentKey(store, "linked", "c1.test.ts", "k-current");
    // Current only in the removed worktree: not protected once it is gone.
    currentKey(store, "removed", "c5.test.ts", "k-current-in-removed");

    store.results.putMany([
      result(testCheck("c1"), "k-current", {
        worktreeId: "removed",
        recordedAt: ago(30),
        runId: "run-cur",
      }),
      result(testCheck("c2"), "k-main-newest", { worktreeId: "main", recordedAt: ago(30) }),
      result(testCheck("c2"), "k-main-older", { worktreeId: "main", recordedAt: ago(40) }),
      result(testCheck("c3"), "k-recent", { worktreeId: "linked", recordedAt: ago(2) }),
      result(testCheck("c3"), "k-expired", { worktreeId: "linked", recordedAt: ago(10) }),
      result(testCheck("c4"), "k-removed-recent", {
        worktreeId: "removed",
        recordedAt: ago(1),
        runId: "run-removed",
      }),
      result(testCheck("c5"), "k-current-in-removed", {
        worktreeId: "linked",
        recordedAt: ago(10),
      }),
      result(testCheck("c6"), "k-boundary", { worktreeId: "linked", recordedAt: ago(7) }),
    ]);

    const outside = tempDir();
    const runs: [string, string, number, number | null, boolean, string?][] = [
      // id, worktree, startedAt, endedAt, fullSuite, logDir
      ["run-cur", "removed", ago(30), ago(30), false],
      ["run-removed", "removed", ago(1), ago(1), false],
      ["run-old-l", "linked", ago(10), ago(10), false],
      ["run-recent-l", "linked", ago(1), ago(1), false],
      ["run-running-l", "linked", ago(20), null, false],
      ["run-full-main", "main", ago(50), ago(50), true],
      ["run-full-main-older", "main", ago(60), ago(60), true, outside],
    ];
    for (const [id, worktreeId, startedAt, endedAt, fullSuite, logDir] of runs) {
      const dir = logDir ?? join(runsDir, id);
      mkdirSync(dir, { recursive: true });
      store.runs.start({
        id,
        worktreeId,
        revision: 1,
        testFiles: [],
        fullSuite,
        logDir: dir,
        startedAt,
      });
      if (endedAt !== null) store.runs.finish(id, "completed", endedAt);
    }

    const report = store.prune({ now: NOW, retentionDays: 7, maxSizeMb: null });

    expect(report).toEqual({
      resultsRemoved: 4,
      runsRemoved: 3,
      worktreesRemoved: 1,
      bytesAfter: expect.any(Number),
    });
    expect(report.bytesAfter).toBeGreaterThan(0);

    expect(store.worktrees.list().map((w) => w.id)).toEqual(["linked", "main"]);
    expect(store.testFileKeys.list("removed")).toEqual([]);

    const allKeys = [
      "k-current",
      "k-main-newest",
      "k-main-older",
      "k-recent",
      "k-expired",
      "k-removed-recent",
      "k-current-in-removed",
      "k-boundary",
    ];
    expect(keys(store, allKeys)).toEqual(["k-current", "k-main-newest", "k-recent", "k-boundary"]);

    const keptRuns = runs.map(([id]) => id).filter((id) => store.runs.get(id) !== null);
    expect(keptRuns).toEqual(["run-cur", "run-recent-l", "run-running-l", "run-full-main"]);
    expect(existsSync(join(runsDir, "run-old-l"))).toBe(false);
    expect(existsSync(join(runsDir, "run-removed"))).toBe(false);
    expect(existsSync(join(runsDir, "run-cur"))).toBe(true);
    // Log directories outside `<store>/runs/` are never deleted.
    expect(existsSync(outside)).toBe(true);

    // A second pass finds nothing more to do.
    expect(store.prune({ now: NOW, retentionDays: 7, maxSizeMb: null })).toMatchObject({
      resultsRemoved: 0,
      runsRemoved: 0,
      worktreesRemoved: 0,
    });
  });

  it("honours retentionDays", () => {
    const { store } = fixture();
    store.results.putMany([
      result(testCheck("a"), "k-3d", { worktreeId: "linked", recordedAt: ago(3) }),
      result(testCheck("a"), "k-1d", { worktreeId: "linked", recordedAt: ago(1) }),
    ]);
    expect(store.prune({ now: NOW, retentionDays: 2, maxSizeMb: null }).resultsRemoved).toBe(1);
    expect(keys(store, ["k-3d", "k-1d"])).toEqual(["k-1d"]);
  });

  it("evicts least recently recorded unprotected results first when over the size cap", () => {
    const { store } = fixture();
    const big = (seed: number): CheckError[] => [
      {
        name: "Error",
        message: `${seed} ${"x".repeat(8_000)}`,
        stack: null,
        location: null,
        diff: null,
      },
    ];
    currentKey(store, "linked", "keep.test.ts", "k-protected");
    store.results.putMany([
      result(testCheck("keep"), "k-protected", {
        worktreeId: "linked",
        recordedAt: ago(1),
        outcome: "fail",
        errors: big(-1),
      }),
    ]);
    const evictable = Array.from({ length: 150 }, (_, i) => `k-${i}`);
    store.results.putMany(
      evictable.map((key, i) =>
        result(testCheck(`t${i}`), key, {
          worktreeId: "linked",
          recordedAt: ago(1) + i,
          outcome: "fail",
          errors: big(i),
        }),
      ),
    );

    const uncapped = store.prune({ now: NOW, retentionDays: 7, maxSizeMb: null });
    expect(uncapped.resultsRemoved).toBe(0);
    expect(uncapped.bytesAfter).toBeGreaterThan(1024 * 1024);

    const capped = store.prune({ now: NOW, retentionDays: 7, maxSizeMb: 0.5 });
    expect(capped.resultsRemoved).toBeGreaterThan(0);
    expect(capped.bytesAfter).toBeLessThanOrEqual(0.5 * 1024 * 1024);

    expect(store.results.byKey("k-protected")).toHaveLength(1);
    const left = keys(store, evictable);
    expect(left.length).toBe(150 - capped.resultsRemoved);
    // The survivors are the most recently recorded ones.
    expect(left).toEqual(evictable.slice(150 - left.length));
  });
});
