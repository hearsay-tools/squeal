import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { storePaths } from "../../src/core/store/index.js";
import type { CheckId, Store } from "../../src/core/types/index.js";
import {
  ALL_TEST_FILES,
  addWorktree,
  createRepo,
  type Harness,
  openHarness,
  openRepoStore,
  SLOW,
} from "../scheduler/helpers.js";
import {
  DAY_MS,
  fakeCommonDir,
  knownState,
  open,
  result,
  tempDir,
  testCheck,
  worktree,
} from "./helpers.js";

/*
 * Row 011-160 (001 D8 as amended 2026-10-23): a removed worktree's results
 * follow the 7-day cutoff instead of going at the next prune, and the runs
 * they name stay with them, so a later worktree at equal content inherits
 * them. Its checks, known states and views go as before.
 */

const NOW = 100 * DAY_MS;
const ago = (days: number) => NOW - days * DAY_MS;
const prune = (store: Store, now: number) =>
  store.prune({ now, retentionDays: 7, maxSizeMb: null });

function startRun(
  store: Store,
  runsDir: string,
  id: string,
  startedAt: number,
  endedAt: number | null,
) {
  mkdirSync(join(runsDir, id), { recursive: true });
  store.runs.start({
    id,
    worktreeId: "removed",
    revision: 1,
    testFiles: [],
    checkpointId: null,
    logDir: join(runsDir, id),
    startedAt,
  });
  if (endedAt !== null) store.runs.finish(id, "completed", endedAt);
}

describe("a removed worktree's results (row 011-160)", () => {
  it("are kept with the runs they name for the 7 days, then go with their logs", () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    const runsDir = storePaths(commonDir).runsDir;
    const removedRoot = tempDir();
    writeFileSync(join(removedRoot, ".git"), `gitdir: ${commonDir}/worktrees/removed\n`);
    store.worktrees.upsert(worktree("main", dirname(commonDir), { isMain: true, commonDir }));
    store.worktrees.upsert(worktree("removed", removedRoot, { commonDir }));
    // Its own current key protects nothing once it is gone.
    store.testFileKeys.upsertMany([
      {
        worktreeId: "removed",
        testFile: { project: "", path: "src/a.test.ts" },
        key: "k-8d",
        revision: 1,
        pending: null,
      },
    ]);
    store.results.putMany([
      result(testCheck("six"), "k-6d", {
        worktreeId: "removed",
        recordedAt: ago(6),
        runId: "r-6d",
      }),
      result(testCheck("eight"), "k-8d", {
        worktreeId: "removed",
        recordedAt: ago(8),
        runId: "r-8d",
      }),
    ]);
    startRun(store, runsDir, "r-6d", ago(6), ago(6));
    startRun(store, runsDir, "r-8d", ago(8), ago(8));
    // Runs that stored nothing go at once, finished or not: no daemon of the worktree finishes them.
    startRun(store, runsDir, "r-none", ago(1), ago(1));
    startRun(store, runsDir, "r-open", ago(1), null);
    store.knownStates.upsertMany([knownState("removed", testCheck("six"))]);
    const consumer = { worktreeId: "removed", sessionId: "s", agentId: "main" };
    store.views.writeMany(consumer, [
      { check: testCheck("viewed"), outcome: "pass", fingerprint: null, toldAt: 1 },
    ]);
    rmSync(removedRoot, { recursive: true });

    const first = prune(store, NOW);

    expect(first).toMatchObject({ worktreesRemoved: 1, resultsRemoved: 1, runsRemoved: 3 });
    expect(store.results.byKey("k-6d")).toHaveLength(1);
    expect(store.results.byKey("k-8d")).toEqual([]);
    const runs = ["r-6d", "r-8d", "r-none", "r-open"];
    expect(runs.filter((id) => store.runs.get(id) !== null)).toEqual(["r-6d"]);
    expect(runs.filter((id) => existsSync(join(runsDir, id)))).toEqual(["r-6d"]);
    // Known states, views and the checks only they name go with the worktree, as before.
    expect(store.knownStates.list("removed")).toEqual([]);
    expect(store.views.list(consumer)).toEqual([]);
    expect(first.checksRemoved).toBe(2);

    // Two days on, the 6-day-old result passes the cutoff: it goes, and its run and log with it.
    const later = prune(store, NOW + 2 * DAY_MS);
    expect(later).toMatchObject({ resultsRemoved: 1, runsRemoved: 1, checksRemoved: 1 });
    expect(store.results.byKey("k-6d")).toEqual([]);
    expect(store.runs.get("r-6d")).toBeNull();
    expect(existsSync(join(runsDir, "r-6d"))).toBe(false);
  });
});

const adds: CheckId = {
  kind: "test",
  project: "",
  testPath: "test/math.test.ts",
  fullName: "adds",
};

/** Registers `h`'s worktree as its daemon would, so prune sees it removed when its `.git` goes. */
function register(store: Store, h: Harness, commonDir: string): void {
  store.worktrees.upsert(worktree(h.worktreeId, h.root, { commonDir }));
}

describe("a later worktree at equal content (row 011-160)", SLOW, () => {
  it("inherits a removed worktree's results after the prune; past 7 days nothing is left", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const aRoot = addWorktree(repo.main, repo.dir, "a");
    const a = await openHarness(aRoot, store, repo.commonDir);
    register(store, a, repo.commonDir);
    await a.scheduler.start();
    await a.scheduler.idle();
    expect(a.sink.stateOf(adds)).toMatchObject({ outcome: "pass", origin: { kind: "own" } });
    const keys = ALL_TEST_FILES.map((path) => a.keyOf(path) ?? "");
    const aRuns = [
      ...new Set(ALL_TEST_FILES.flatMap((p) => a.runsOf(p).map((run) => run.options.runId))),
    ];
    expect(aRuns.length).toBeGreaterThan(0);
    await a.scheduler.close();

    // A's root loses its `.git` entry, as `git worktree remove` leaves it; the prune removes A.
    rmSync(join(aRoot, ".git"));
    expect(prune(store, Date.now())).toMatchObject({ worktreesRemoved: 1, resultsRemoved: 0 });
    for (const key of keys) expect(store.results.byKey(key).length).toBeGreaterThan(0);
    for (const id of aRuns) expect(existsSync(store.runs.get(id)?.logDir ?? "")).toBe(true);

    const bRoot = addWorktree(repo.main, repo.dir, "b");
    const b = await openHarness(bRoot, store, repo.commonDir);
    register(store, b, repo.commonDir);
    await b.scheduler.start();
    await b.scheduler.idle();
    for (const path of ALL_TEST_FILES) expect(b.runsOf(path)).toEqual([]);
    expect(ALL_TEST_FILES.map((path) => b.keyOf(path))).toEqual(keys);
    expect(b.sink.stateOf(adds)).toMatchObject({
      outcome: "pass",
      validity: "current",
      origin: { kind: "inherited", worktreeId: a.worktreeId },
    });
    await b.scheduler.close();

    // With B removed too, no live key holds them: 8 days on, results, runs and logs are gone.
    const logDirs = aRuns.map((id) => store.runs.get(id)?.logDir ?? "");
    rmSync(join(bRoot, ".git"));
    expect(prune(store, Date.now() + 8 * DAY_MS)).toMatchObject({ worktreesRemoved: 1 });
    for (const key of keys) expect(store.results.byKey(key)).toEqual([]);
    for (const id of aRuns) expect(store.runs.get(id)).toBeNull();
    for (const dir of logDirs) expect(existsSync(dir)).toBe(false);
  });
});
