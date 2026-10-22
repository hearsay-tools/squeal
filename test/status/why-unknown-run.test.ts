import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatWhy, readWhy } from "../../src/core/status/index.js";
import { UNKNOWN_RUNS_META_KEY } from "../../src/core/store/repos/unknown-runs.js";
import type { Store } from "../../src/core/types/index.js";
import { result } from "../store/helpers.js";
import { type FakeRepo, fakeRepo, seedStore, state } from "./helpers.js";
import { at, LOGIN, reportOf } from "./why-seed.js";

/*
 * Row 011-108 (gh-74): a missing log of the run behind an UNKNOWN names one
 * reason: its run was pruned, no log was ever written (no run, or a run that
 * wrote none), or the UNKNOWN was recorded by a daemon older than this row.
 * And prune keeps that run while the UNKNOWN stands, then lets it go.
 */

const REASON = "unhandled error outside any test file: Error: Worker forks emitted error.";
const FILE = { project: "", path: "src/auth.test.ts" };
const DAY_MS = 24 * 60 * 60 * 1000;

function seed() {
  const repo = fakeRepo();
  const store = seedStore(repo);
  store.worktrees.upsert({
    id: repo.mainId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  // A newer pass from another worktree: every stored result of the check is a pass.
  store.results.putMany([result(LOGIN, "k-other", { worktreeId: "wt-other", recordedAt: at(12) })]);
  store.knownStates.upsertMany([
    state(repo.mainId, LOGIN, {
      outcome: "unknown",
      validity: "unknown",
      observedAt: 7,
      summary: REASON,
    }),
  ]);
  return { repo, store, runsDir: join(repo.commonDir, "squeal", "runs") };
}

function startRun(store: Store, repo: FakeRepo, runsDir: string, id: string, started: number) {
  const logDir = join(runsDir, id);
  store.runs.start({
    id,
    worktreeId: repo.mainId,
    revision: 6,
    testFiles: [FILE],
    checkpointId: null,
    logDir,
    startedAt: started,
  });
  store.runs.finish(id, "crashed", started);
  return logDir;
}

const mark = (store: Store, repo: FakeRepo, runId: string | null, revision = 7) =>
  store.transaction(() =>
    store.failures.recordUnknownRuns(
      repo.mainId,
      revision,
      [{ testFiles: [FILE], reason: REASON, runId }],
      at(11),
    ),
  );

const why = (repo: FakeRepo) => reportOf(readWhy(repo.main, "auth > login"));

describe("the run behind an UNKNOWN, and a missing log's one reason (011-108)", () => {
  it("names the run, its revision and its log when the log is there", () => {
    const { repo, store, runsDir } = seed();
    const logDir = startRun(store, repo, runsDir, "run-x", at(11));
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, "vitest.log"), "[stderr] Worker forks emitted error\n");
    mark(store, repo, "run-x");

    const report = why(repo);
    expect(report.unknownRun).toEqual({
      runId: "run-x",
      worktreeId: repo.mainId,
      revision: 6,
      error: REASON,
      log: expect.objectContaining({ state: "present", path: join(logDir, "vitest.log") }),
    });
    const text = formatWhy(report);
    expect(text).toContain(`Run log: ${join(logDir, "vitest.log")}`);
    expect(text).toContain(
      `Run run-x in ${repo.main} (this worktree) at revision 6 ended this check UNKNOWN.`,
    );
  });

  it("says pruned when its run record is gone", () => {
    const { repo, store } = seed();
    mark(store, repo, "run-gone");
    expect(why(repo).unknownRun).toMatchObject({
      runId: "run-gone",
      revision: 7,
      missing: "pruned",
    });
    expect(formatWhy(why(repo))).toContain(
      "Run log: none; run run-gone in " +
        repo.main +
        " (this worktree) at revision 7 ended this check UNKNOWN, and its run record and log were pruned",
    );
  });

  it("says never written when its run wrote no log, or no run produced it", () => {
    const { repo, store, runsDir } = seed();
    startRun(store, repo, runsDir, "run-quiet", at(11));
    mark(store, repo, "run-quiet");
    expect(why(repo).unknownRun).toMatchObject({ runId: "run-quiet", missing: "never-written" });
    expect(formatWhy(why(repo))).toContain("ended this check UNKNOWN and never wrote its log");

    mark(store, repo, null);
    expect(why(repo).unknownRun).toMatchObject({ runId: null, missing: "never-written" });
    expect(formatWhy(why(repo))).toContain("Run log: none; no run ended this check UNKNOWN");
  });

  it("says an older daemon recorded it when no record fits the state", () => {
    const { repo, store } = seed();
    expect(why(repo).unknownRun).toMatchObject({
      runId: null,
      revision: 7,
      missing: "older-daemon",
    });
    // A record of an earlier UNKNOWN at another revision does not fit this one.
    mark(store, repo, "run-earlier", 3);
    expect(why(repo).unknownRun?.missing).toBe("older-daemon");
    expect(formatWhy(why(repo))).toContain(
      "Run log: none; a Squeal daemon older than this release recorded this UNKNOWN",
    );
    expect(formatWhy(why(repo))).not.toContain("no stored result, or several, fit the known state");
  });

  it("is absent for a state that is not UNKNOWN, and never a keyed result", () => {
    const { repo, store } = seed();
    mark(store, repo, "run-x");
    store.knownStates.upsertMany([state(repo.mainId, LOGIN, { outcome: "pass" })]);
    expect(why(repo).unknownRun).toBeUndefined();
    expect(store.results.listForCheck(LOGIN, 10).map((r) => r.outcome)).toEqual(["pass"]);
  });

  it("prune keeps its run and log while the UNKNOWN stands, past the cutoff, then lets them go", () => {
    const { repo, store, runsDir } = seed();
    const logDir = startRun(store, repo, runsDir, "run-x", at(11));
    mkdirSync(logDir, { recursive: true });
    mark(store, repo, "run-x");
    const later = at(11) + 8 * DAY_MS;

    store.prune({ now: later, retentionDays: 7, maxSizeMb: null });
    expect(store.runs.get("run-x")).not.toBeNull();
    expect(store.failures.unknownRuns(repo.mainId)).toHaveLength(1);

    store.knownStates.upsertMany([state(repo.mainId, LOGIN, { outcome: "pass", observedAt: 8 })]);
    store.prune({ now: later, retentionDays: 7, maxSizeMb: null });
    expect(store.failures.unknownRuns(repo.mainId)).toEqual([]);
    expect(store.meta.get(UNKNOWN_RUNS_META_KEY)).toBeNull();
    expect(store.runs.get("run-x")).toBeNull();
  });
});
