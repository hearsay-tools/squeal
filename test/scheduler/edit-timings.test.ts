import { describe, expect, it } from "vitest";
import { pastBound, worktreeMedians } from "../../src/core/delivery/late-timings.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import {
  readEditTimings,
  recordEditTier,
  TIMINGS_KEPT,
} from "../../src/core/scheduler/edit-timings.js";
import type { Tier, TierKind } from "../../src/core/scheduler/tiers.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { declareTraits } from "../../src/core/types/runner-traits.js";
import type { Store } from "../../src/core/types/store.js";
import { freshStore, WT } from "../state/helpers.js";

/*
 * Row 005-93, review 0.1.530 B2 and B3: the scheduler records, at each edit tier's start, the
 * tier size, each project's width and part, the first start of each edit revision and each edit
 * tier's estimate. The late bound reads them: a revision's later tiers never replace its first
 * start, and a one-worker runner's files are estimated one after another.
 */

const FILE: TestFileRef = { project: "unit", path: "src/a.test.ts" };

function context(store: Store, now: () => number, width = 1, tierSize = 4): SchedulerContext {
  return {
    store,
    worktreeId: WT,
    now,
    policy: { runner: { tierSize } },
    runner: {
      traits: declareTraits({ tierWidth: () => width, tierPart: (ref) => `vitest:${ref.project}` }),
    },
  } as unknown as SchedulerContext;
}

/** A tier of `kind` at `revision` that started at `startedAt`, of files of 1 s. */
function tier(id: string, revision: number, startedAt: number, kind: TierKind = "edit"): Tier {
  return {
    runId: id,
    kind,
    revision: { number: revision, head: null, dirty: true },
    files: [{ file: { ref: FILE, durationMs: 1_000 } }],
    startedAt,
  } as unknown as Tier;
}

function revisionAt(store: Store, createdAt: number): number {
  return store.revisions.append({
    worktreeId: WT,
    createdAt,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: [{ path: "src/a.ts", oldHash: null, newHash: `h${createdAt}` }],
  }).number;
}

/** A completed run of `id` that took `ms`. */
function ran(store: Store, id: string, startedAt: number, ms: number): void {
  store.runs.start({
    id,
    worktreeId: WT,
    revision: 1,
    testFiles: [FILE],
    checkpointId: null,
    logDir: `/tmp/${id}`,
    startedAt,
  });
  store.runs.finish(id, "completed", startedAt + ms);
}

describe("the scheduler's record of edit tiers (review 0.1.530 B3)", () => {
  it("keeps a revision's first start when more than 20 later tiers run at it", () => {
    const store = freshStore();
    const ctx = context(store, () => 0);
    const first = revisionAt(store, 0);
    recordEditTier(ctx, tier("r0", first, 1_000), 1);
    ran(store, "r0", 1_000, 1_000);
    for (let i = 0; i < TIMINGS_KEPT + 5; i++) {
      recordEditTier(ctx, tier(`r${i + 1}`, first, 600_000 + i * 1_000), 1);
      ran(store, `r${i + 1}`, 600_000 + i * 1_000, 1_000);
    }
    expect(readEditTimings(store, WT)?.firsts).toEqual([{ revision: first, delayMs: 1_000 }]);
    expect(worktreeMedians(store, WT)).toEqual({ startMs: 1_000, overheadMs: 0 });
    // The next edit's own first start is kept beside it.
    const next = revisionAt(store, 700_000);
    recordEditTier(ctx, tier("r-next", next, 703_000), 1);
    expect(readEditTimings(store, WT)?.firsts).toEqual([
      { revision: next, delayMs: 3_000 },
      { revision: first, delayMs: 1_000 },
    ]);
    expect(worktreeMedians(store, WT).startMs).toBe(2_000);
    // A file with no stored duration is late after 2 × 2 s, not after a backlog's 600 s.
    expect(pastBound(store, WT, [FILE], 10_000)).toBe(true);
  });

  it("keeps the newest 20 first starts and edit tiers, newest first (row 005-96)", () => {
    const store = freshStore();
    const ctx = context(store, () => 0);
    for (let i = 0; i < TIMINGS_KEPT + 5; i++) {
      const revision = revisionAt(store, i * 10_000);
      recordEditTier(ctx, tier(`r${i}`, revision, i * 10_000 + i), 1);
    }
    const timings = readEditTimings(store, WT);
    expect(timings?.firsts).toHaveLength(TIMINGS_KEPT);
    expect(timings?.tiers).toHaveLength(TIMINGS_KEPT);
    expect(timings?.firsts[0]?.delayMs).toBe(TIMINGS_KEPT + 4);
    expect(timings?.firsts.at(-1)?.delayMs).toBe(5);
    expect(timings?.tiers.map((t) => t.runId).slice(0, 2)).toEqual(["r24", "r23"]);
  });

  it("records only edit tiers: a backlog or slow tier is no edit's start", () => {
    const store = freshStore();
    const ctx = context(store, () => 0);
    const revision = revisionAt(store, 0);
    for (const kind of ["backlog", "slow", "turn", "focused"] as const) {
      recordEditTier(ctx, tier(`r-${kind}`, revision, 500_000, kind), 1);
    }
    expect(readEditTimings(store, WT)).toBeNull();
  });

  it("reads overhead as a completed run's wall time less the scheduler's estimate", () => {
    const store = freshStore();
    const ctx = context(store, () => 0);
    const revision = revisionAt(store, 0);
    recordEditTier(ctx, tier("r1", revision, 0), 1);
    ran(store, "r1", 0, 3_500);
    expect(readEditTimings(store, WT)?.tiers).toEqual([{ runId: "r1", estimateMs: 1_000 }]);
    expect(worktreeMedians(store, WT).overheadMs).toBe(2_500);
  });
});

describe("the width and tier size the bound reads (review 0.1.530 B2)", () => {
  /** Four owed 10 s files of `FILE`'s project, recorded at `width` and `tierSize`. */
  function bound(width: number, tierSize: number) {
    const store = freshStore();
    const files = ["a", "b", "c", "d"].map((n) => ({ project: "unit", path: `src/${n}.test.ts` }));
    store.results.putMany(
      files.map((f, i) => ({
        check: { kind: "file", project: f.project, testPath: f.path },
        key: `k${i}`,
        outcome: "pass",
        durationMs: 10_000,
        location: null,
        fingerprint: null,
        summary: null,
        errors: [],
        provenance: {
          worktreeId: WT,
          revision: 1,
          commit: "c",
          dirty: false,
          runId: "x",
          recordedAt: 1,
        },
      })) as never,
    );
    recordEditTier(
      context(store, () => 0, width, tierSize),
      tier("r1", revisionAt(store, 0), 0),
      width,
    );
    return (age: number) => pastBound(store, WT, files, age);
  }

  it("a one-worker runner: four 10 s files are on time at 70 s and late past 80 s", () => {
    const late = bound(1, 4);
    expect(late(70_000)).toBe(false);
    expect(late(80_001)).toBe(true);
  });

  it("a tier size of two at two workers: late past 60 s", () => {
    const late = bound(2, 2);
    expect(late(59_000)).toBe(false);
    expect(late(60_001)).toBe(true);
  });
});
