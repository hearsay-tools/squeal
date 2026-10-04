import { describe, expect, it } from "vitest";
import {
  ALL_TEST_FILES,
  addWorktree,
  createRepo,
  openHarness,
  openRepoStore,
  ref,
  SLOW,
} from "./helpers.js";

describe("scheduler: baseline and run --all (D5, D7)", SLOW, () => {
  it("baseline looks every test file up, then runs the misses in tiers of one checkpoint", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 2 });

    await h.scheduler.start();
    await h.scheduler.idle();

    // Five files in tiers of two.
    expect(h.runner.runs.map((r) => r.files.length)).toEqual([2, 2, 1]);
    const ran = h.runner.runs.flatMap((r) => r.files.map((f) => f.path)).sort();
    expect(ran).toEqual(ALL_TEST_FILES);

    const checkpoint = store.checkpoints.lastCompleted(h.worktreeId);
    expect(checkpoint?.kind).toBe("baseline");
    expect(checkpoint?.testFiles.map((f) => f.path).sort()).toEqual(ALL_TEST_FILES);
    for (const run of h.runner.runs) {
      expect(store.runs.get(run.options.runId)?.checkpointId).toBe(checkpoint?.id);
      expect(store.runs.get(run.options.runId)?.end).toBe("completed");
    }

    // Every file current: keyed, nothing pending, results under its key.
    const rows = store.testFileKeys.list(h.worktreeId);
    expect(rows.map((r) => r.testFile.path)).toEqual(ALL_TEST_FILES);
    for (const row of rows) {
      expect(row.pending).toBeNull();
      expect(store.results.byKey(row.key).length).toBeGreaterThan(0);
    }
    const status = h.scheduler.status();
    expect(status.testFiles).toEqual({ current: 5, pending: 0, stale: 0, unknown: 0 });
    expect(status.checks).toEqual({ current: 6, pending: 0, stale: 0, unknown: 0 });
    expect(status.lookups).toEqual({ hits: 0, misses: 5 });
    expect(
      h.sink.stateOf({
        kind: "test",
        project: "",
        testPath: "test/plain.test.ts",
        fullName: "is plain",
      }),
    ).toMatchObject({ outcome: "pass", validity: "current", origin: { kind: "own" } });
  });

  it("run --all --force is one run-all checkpoint with several tier runs", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 2 });
    await h.scheduler.start();
    await h.scheduler.idle();
    const baselineRuns = h.runner.runs.length;

    const checkpoint = await h.scheduler.requestFullSuite({ force: true });
    await h.scheduler.idle();

    expect(checkpoint.kind).toBe("run-all");
    expect(checkpoint.testFiles.map((f) => f.path).sort()).toEqual(ALL_TEST_FILES);
    const tiers = h.runner.runs.slice(baselineRuns);
    expect(tiers.length).toBe(3);
    for (const run of tiers) {
      expect(store.runs.get(run.options.runId)?.checkpointId).toBe(checkpoint.id);
    }
    expect(store.checkpoints.get(checkpoint.id)?.end).toBe("completed");
    expect(store.checkpoints.lastCompleted(h.worktreeId)?.id).toBe(checkpoint.id);
  });

  it("run --all without --force completes at once when every key has a result", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir);
    await h.scheduler.start();
    await h.scheduler.idle();
    const runs = h.runner.runs.length;

    const checkpoint = await h.scheduler.requestFullSuite();
    await h.scheduler.idle();

    expect(checkpoint.testFiles).toEqual([]);
    expect(store.checkpoints.get(checkpoint.id)?.end).toBe("completed");
    expect(h.runner.runs.length).toBe(runs);
  });

  it("a second worktree bootstraps by lookup: zero runs, every result inherited", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const a = await openHarness(repo.main, store, repo.commonDir);
    await a.scheduler.start();
    await a.scheduler.idle();

    const root = addWorktree(repo.main, repo.dir, "second");
    const b = await openHarness(root, store, repo.commonDir);
    await b.scheduler.start();
    await b.scheduler.idle();

    expect(b.runner.runs).toEqual([]);
    expect(b.scheduler.status().lookups).toEqual({ hits: 5, misses: 0 });
    expect(b.scheduler.status().testFiles).toEqual({
      current: 5,
      pending: 0,
      stale: 0,
      unknown: 0,
    });
    for (const path of ALL_TEST_FILES) expect(b.keyOf(path)).toBe(a.keyOf(path));

    const applied = b.sink.callsOf("applyResults").flatMap((c) => c.results);
    expect(applied).toHaveLength(6);
    expect(new Set(applied.map((r) => r.provenance.worktreeId))).toEqual(new Set([a.worktreeId]));
    for (const state of b.sink.states()) {
      expect(state.validity).toBe("current");
      expect(state.origin).toEqual({
        kind: "inherited",
        worktreeId: a.worktreeId,
        commit: expect.any(String),
      });
    }
    const baseline = store.checkpoints.lastCompleted(b.worktreeId);
    expect(baseline).toMatchObject({ kind: "baseline", testFiles: [], end: "completed" });
    expect(b.sink.callsOf("applyResults").every((c) => c.checkpointId === baseline?.id)).toBe(true);
  });

  it("lookup-only baseline queues nothing and leaves an abandoned checkpoint for its misses", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      policy: { baseline: { onStart: "lookup-only" } },
    });
    await h.scheduler.start();
    await h.scheduler.idle();

    expect(h.runner.runs).toEqual([]);
    expect(store.checkpoints.lastCompleted(h.worktreeId)).toBeNull();
    expect(h.scheduler.status().testFiles).toEqual({
      current: 0,
      pending: 0,
      stale: 0,
      unknown: 5,
    });
    expect(h.keyOf("test/math.test.ts")).toMatch(/^[0-9a-f]{64}$/);

    // An edit still runs what it affects.
    h.write("src/math.ts", "export const add = (a: number, b: number) => b + a;\n");
    await h.batch("src/math.ts");
    await h.scheduler.idle();
    expect(h.runner.runs.flatMap((r) => r.files)).toEqual([ref("test/math.test.ts")]);
  });

  it("a restarted daemon runs nothing and watches the generated file again", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const first = await openHarness(repo.main, store, repo.commonDir);
    await first.scheduler.start();
    await first.scheduler.idle();
    await first.scheduler.close();
    await first.runner.close();

    const second = await openHarness(repo.main, store, repo.commonDir);
    await second.scheduler.start();
    await second.scheduler.idle();

    expect(second.runner.runs).toEqual([]);
    expect(second.scheduler.status().lookups).toEqual({ hits: 5, misses: 0 });
    expect(second.scheduler.extraFiles()).toEqual(["src/gen/client.ts"]);
    // Nothing changed while no daemon ran: no revision.
    expect(store.revisions.latest(second.worktreeId)).toBeNull();
  });
});
