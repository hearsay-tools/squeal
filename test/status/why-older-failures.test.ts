import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatWhy, readWhy, WHY_RESULT_LIMIT } from "../../src/core/status/index.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { ResultRecord, Store } from "../../src/core/types/index.js";
import { result } from "../store/helpers.js";
import { type FakeRepo, fakeRepo, seedStore, state } from "./helpers.js";
import { at, LOGIN, reportOf } from "./why-seed.js";

/*
 * 011-64 R3 tests 3 and 4 (row 011-77): `why` keeps a check's older stored
 * failures visible below its newest 20 results, and says what was pruned of
 * a replaced failure, never printing a stale path.
 */

function register(repo: FakeRepo, store: Store): void {
  store.worktrees.upsert({
    id: repo.mainId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
}

function failed(key: string, minute: number): ResultRecord {
  const r = result(LOGIN, key, {
    outcome: "fail",
    recordedAt: at(9, minute),
    runId: `fail-${minute}`,
    errors: [
      {
        name: "AssertionError",
        message: "boom",
        stack: `AssertionError: boom ${minute}`,
        location: null,
        diff: null,
      },
    ],
  });
  return {
    ...r,
    summary: `boom ${minute}`,
    provenance: { ...r.provenance, worktreeId: "wt-main" },
  };
}

describe("why's older failures and replaced failures (011-77)", () => {
  it("lists two stored fails below 22 newer passes under Older failures still stored", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    register(repo, store);
    const passes = Array.from({ length: WHY_RESULT_LIMIT + 2 }, (_, i) =>
      result(LOGIN, `k-pass-${i}`, {
        worktreeId: repo.mainId,
        recordedAt: at(10, i),
        runId: `p${i}`,
      }),
    );
    store.results.putMany([failed("k-old-1", 1), failed("k-old-2", 2), ...passes]);
    store.knownStates.upsertMany([state(repo.mainId, LOGIN, { outcome: "pass" })]);

    const why = reportOf(readWhy(repo.main, "auth > login"));
    expect(why.results.every((r) => r.result.outcome === "pass")).toBe(true);
    expect(why.olderFailures?.map((r) => r.result.provenance.runId)).toEqual(["fail-2", "fail-1"]);
    const text = formatWhy(why);
    expect(text).toContain("Older failures still stored (2, newest first):");
    expect(text).toMatch(
      /Older failures[^\n]*\n {2}FAIL {2}2026-10-04T09:02:00\.000Z[\s\S]*boom 2/,
    );
  });

  it("keeps at most 5 older failures, and none when every stored result is listed", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    register(repo, store);
    const passes = Array.from({ length: WHY_RESULT_LIMIT }, (_, i) =>
      result(LOGIN, `k-pass-${i}`, {
        worktreeId: repo.mainId,
        recordedAt: at(10, i),
        runId: `p${i}`,
      }),
    );
    store.results.putMany([failed("k-a", 1)]);
    store.knownStates.upsertMany([state(repo.mainId, LOGIN, { outcome: "pass" })]);
    expect(reportOf(readWhy(repo.main, "auth > login")).olderFailures).toBeUndefined();
    store.results.putMany([
      ...Array.from({ length: 7 }, (_, i) => failed(`k-old-${i}`, 2 + i)),
      ...passes,
    ]);
    const why = reportOf(readWhy(repo.main, "auth > login"));
    expect(why.olderFailures).toHaveLength(5);
    expect(why.olderFailures?.[0]?.result.provenance.runId).toBe("fail-8");
  });

  it("says a replaced failure's text and run were pruned, as a release before 011-77 prunes them", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    register(repo, store);
    const runsDir = join(repo.commonDir, "squeal", "runs");
    const logDir = join(runsDir, "fail-1");
    mkdirSync(logDir, { recursive: true });
    store.runs.start({
      id: "fail-1",
      worktreeId: repo.mainId,
      revision: 1,
      testFiles: [],
      checkpointId: null,
      logDir,
      startedAt: at(9, 1),
    });
    const fail = failed("k1", 1);
    store.results.putMany([fail]);
    store.transaction(() => {
      const failing = store.failures.failingAt("k1");
      const pass = result(LOGIN, "k1", {
        worktreeId: repo.mainId,
        recordedAt: at(9, 5),
        runId: "p1",
      });
      store.results.putMany([pass]);
      store.failures.keepReplaced(failing, [pass], () => null);
    });
    store.knownStates.upsertMany([state(repo.mainId, LOGIN, { outcome: "pass" })]);

    const kept = formatWhy(readWhy(repo.main, "auth > login"));
    expect(kept).toContain("Replaced failures (1, newest first):");
    expect(kept).toContain(`log: ${logDir}`);
    expect(kept).toContain("AssertionError: boom 1");
    expect(kept).toContain("load per CPU then not recorded");

    // An older release's prune: the text at its next pass, the run and its log at the cutoff.
    const conn = connectionOf(store);
    conn.run(
      "DELETE FROM failure_texts WHERE id NOT IN (SELECT failure_id FROM results WHERE failure_id IS NOT NULL)",
    );
    const textGone = formatWhy(readWhy(repo.main, "auth > login"));
    expect(textGone).toContain("failure text pruned: its errors and stack are gone");
    expect(textGone).not.toContain("AssertionError: boom 1");
    expect(textGone).toContain(`log: ${logDir}`);

    conn.run("DELETE FROM runs WHERE id = 'fail-1'");
    const why = reportOf(readWhy(repo.main, "auth > login"));
    expect(why.replacedFailures?.[0]).toMatchObject({ logDir: null, errors: null });
    const runGone = formatWhy(why);
    expect(runGone).toContain("log: run record pruned");
    expect(runGone).not.toContain(logDir);
  });
});
