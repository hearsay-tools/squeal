import { describe, expect, it } from "vitest";
import type { FileCheckId } from "../../src/core/types/check.js";
import { fakeCommonDir, open, result, testCheck } from "./helpers.js";

/*
 * Row 005-93: the late bound measures this worktree's start delay and overhead from its newest
 * completed runs the daemon scheduled on its own, each with its files' durations from its own
 * results.
 */

const WT = "wt-main";
const fileCheck = (path: string): FileCheckId => ({ kind: "file", project: "", testPath: path });

describe("store: a worktree's recent run timings (row 005-93)", () => {
  it("lists completed edit runs newest first with each file's duration, at most `limit`", () => {
    const store = open(fakeCommonDir());
    const run = (id: string, startedAt: number, extra: { checkpointId?: string } = {}) =>
      store.runs.start({
        id,
        worktreeId: WT,
        revision: startedAt,
        testFiles: [],
        checkpointId: extra.checkpointId ?? null,
        logDir: "/tmp/x",
        startedAt,
      });
    run("old", 10);
    store.runs.finish("old", "completed", 15);
    run("new", 20);
    store.runs.finish("new", "completed", 29);
    run("checkpoint", 30, { checkpointId: "cp" });
    store.runs.finish("checkpoint", "completed", 31);
    run("crashed", 40);
    store.runs.finish("crashed", "crashed", 41);
    run("running", 50);
    store.runs.start({
      id: "other-wt",
      worktreeId: "wt-b",
      revision: 5,
      testFiles: [],
      checkpointId: null,
      logDir: "/tmp/x",
      startedAt: 55,
    });
    store.runs.finish("other-wt", "completed", 60);
    const timed = (r: ReturnType<typeof result>, ms: number) => ({ ...r, durationMs: ms });
    store.results.putMany([
      // a.test.ts: two tests of 3 and 4 s under a 5 s file check: the tests' 7 s count.
      timed(result(testCheck("one"), "ka", { runId: "new" }), 3_000),
      timed(result(testCheck("two"), "ka", { runId: "new" }), 4_000),
      timed(result(fileCheck("src/a.test.ts"), "ka", { runId: "new" }), 5_000),
      // b.test.ts: a 9 s file check over a 1 s test: the file's 9 s count.
      timed(result(testCheck("one", "src/b.test.ts"), "kb", { runId: "new" }), 1_000),
      timed(result(fileCheck("src/b.test.ts"), "kb", { runId: "new" }), 9_000),
      timed(result(testCheck("one", "src/c.test.ts"), "kc", { runId: "old" }), 2_000),
    ]);

    const timings = store.runs.recentTimings(WT, 10);
    expect(timings.map((t) => [t.revision, t.startedAt, t.endedAt])).toEqual([
      [20, 20, 29],
      [10, 10, 15],
    ]);
    expect([...(timings[0]?.durations ?? [])].sort((a, b) => a - b)).toEqual([7_000, 9_000]);
    expect(timings[1]?.durations).toEqual([2_000]);
    expect(store.runs.recentTimings(WT, 1)).toHaveLength(1);
  });
});
