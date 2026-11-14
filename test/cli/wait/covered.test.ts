import { afterEach, describe, expect, it } from "vitest";
import { requestFiles } from "../../../src/cli/wait/covered.js";
import { runWait } from "../../../src/cli/wait/wait.js";
import { type CoveredFile, writeCoveredFiles } from "../../../src/core/store/covered-files.js";
import type { EpochMs, RevisionNumber } from "../../../src/core/types/common.js";
import type { Store } from "../../../src/core/types/store.js";
import type { CheckpointLane } from "../../../src/core/types/store-records.js";
import { closeFakeDaemons, lockStore } from "../fake-daemon.js";
import { closeLoopFixtures, ref, scratch, socketPath, steppedClock } from "./fixture.js";

/*
 * Row 011-328: a run wait reads its request's covered files from the
 * scheduler's record, by the id in the daemon's answer, once, right after
 * the answer (`requestFiles`), in place of today's guess from the policy.
 * An answer without an id (an older daemon), an id whose record is gone,
 * and a store the read cannot open keep the guess. Each row's record and
 * guess differ, so the files the wait counts say which one it read.
 */

afterEach(() => {
  closeFakeDaemons();
  closeLoopFixtures();
});

/** The record's id in the rows; "gone" names none. */
const RECORD = "r1";

/** Writes request `id`'s covered `files`, as the scheduler's intake does when it takes it. */
function record(store: Store, worktreeId: string, files: readonly CoveredFile[]): void {
  writeCoveredFiles(
    store,
    {
      id: RECORD,
      worktreeId,
      revision: 3 as RevisionNumber,
      recordedAt: Date.now() as EpochMs,
      files,
    },
    { listed: () => true, pending: () => false, leftAt: () => null, knownSince: 0 as EpochMs },
  );
}

const E2E = "test/e2e/a.test.ts";
const E2E_B = "test/e2e/b.test.ts";
const GROUPS = {
  checks: [{ name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop" }],
};

describe("a group wait's files (row 011-328)", () => {
  /** Group e2e's two files current; the record names one of them. */
  function groupWait(coveredId: string | undefined) {
    const w = scratch(GROUPS);
    w.file(E2E);
    w.file(E2E_B);
    record(w.store, w.id, [{ testFile: ref(E2E_B), state: "current" }]);
    const clock = steppedClock();
    const deadline = clock.start + 60_000;
    const { files } = requestFiles(
      { root: w.root, coveredId, deadline },
      { kind: "group", group: "e2e" },
      clock.ports.now,
    );
    const ask = { wait: "group", root: w.root, socketPath: socketPath(), deadline, files } as const;
    return { w, clock, ask };
  }

  it.each([
    ["an answer that names a record: the record's files", RECORD, 1],
    ["an answer without an id (an older daemon): the group's by the policy", undefined, 2],
    ["an id whose record is gone: the group's by the policy", "gone", 2],
  ])("%s", async (_, coveredId, testFiles) => {
    const { clock, ask } = groupWait(coveredId);
    expect(await runWait(ask, clock.ports)).toMatchObject({
      kind: "ended",
      verdict: { testFiles },
    });
  });

  it("a store busy at the record's read: the group's by the policy, the read bounded by the deadline", async () => {
    const w = scratch(GROUPS);
    record(w.store, w.id, [{ testFile: ref(E2E_B), state: "current" }]);
    w.store.close();
    lockStore(w.commonDir);
    const started = performance.now();
    const read = requestFiles(
      { root: w.root, coveredId: RECORD, deadline: Date.now() + 100 },
      { kind: "group", group: "e2e" },
    );
    expect(read).toEqual({ files: { kind: "group", group: "e2e" }, covered: null });
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

const A = "test/a.test.ts";
const B = "test/b.test.ts";

describe("a checkpoint wait's files (row 011-328)", () => {
  /** A completed checkpoint `c1` of `lane` over `A` and `B`, both current; the record names `A`. */
  function checkpointWait(lane: CheckpointLane | null, coveredId: string | undefined) {
    const w = scratch({ slow: { include: ["test/e2e/**"] } });
    w.file(A);
    w.file(B);
    w.store.checkpoints.start({
      id: "c1",
      worktreeId: w.id,
      revision: 3 as RevisionNumber,
      kind: "run-all",
      testFiles: [ref(A), ref(B)],
      startedAt: 1,
      ...(lane === null ? {} : { lane }),
    });
    w.store.checkpoints.finish("c1", "completed", 2);
    record(w.store, w.id, [{ testFile: ref(A), state: "queued" }]);
    const clock = steppedClock();
    const deadline = clock.start + 60_000;
    const { files } = requestFiles(
      { root: w.root, coveredId, deadline },
      { kind: "lane", lane },
      clock.ports.now,
    );
    const ask = {
      wait: "checkpoint",
      root: w.root,
      socketPath: socketPath(),
      deadline,
      checkpoint: { id: "c1", worktreeId: w.id, revision: 3 },
      files,
    } as const;
    return { clock, ask };
  }

  it.each([
    ["one lane, an answer that names a record: the record's files", "fast", RECORD, 1],
    ["one lane, an answer without an id: the lane's by the policy", "fast", undefined, 2],
    ["one lane, an id whose record is gone: the lane's by the policy", "fast", "gone", 2],
    ["both lanes, an answer that names a record: every listed file, as before", null, RECORD, 2],
  ] as const)("%s", async (_, lane, coveredId, testFiles) => {
    const { clock, ask } = checkpointWait(lane, coveredId);
    expect(await runWait(ask, clock.ports)).toMatchObject({
      kind: "ended",
      verdict: { testFiles },
    });
  });
});
