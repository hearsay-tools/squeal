import { afterEach, describe, expect, it } from "vitest";
import type { PoolLease } from "../../src/core/capacity/pool.js";
import { StatCache } from "../../src/core/hash/stat-cache.js";
import { type TierCapacity, WAIT_FOR_CAPACITY } from "../../src/core/scheduler/capacity.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { Priority } from "../../src/core/scheduler/queue.js";
import { NONE_CUT } from "../../src/core/scheduler/sharing.js";
import { executeTier, selectTier, type Tier } from "../../src/core/scheduler/tiers.js";
import { createStateSink } from "../../src/core/state/sink.js";
import type { WorktreeId } from "../../src/core/types/common.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import type { RunReport } from "../../src/core/types/runner.js";
import type { Store } from "../../src/core/types/store.js";
import { liveDaemon } from "../delivery/fakes.js";
import { freshStore } from "../state/helpers.js";

/*
 * Row 011-308 (spec 011 C10 Capacity and C15 "A batch on a busy host", as
 * amended 2026-11-07; `tasks/011-308/design.md` D1): a named wait's batch
 * never starts later or narrower than an edit's tier would. When the pool
 * refuses its tier, or grants fewer workers than an edit's tier of its
 * files runs with, the tier starts at once without a permit: at most
 * `runner.tierSize` (4) batch files, longest first, stated to the pool as
 * an edit's tier is (`TierCapacity.running`). A pool that grants keeps row
 * 011-268's one wide tier. `selectTier` on a `Ledger`, one lane, a fake pool.
 */

const WT = "wt-011-308" as WorktreeId;
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

/** A pool that grants `grant` workers to each take, or refuses with `null`, and records the calls. */
function fakePool(grant: number | null) {
  const calls = { takes: 0, released: 0, running: [] as number[], ended: 0 };
  const capacity = {
    offer: (want: number) => (grant === null ? 0 : Math.min(want, grant)),
    take: (want: number): PoolLease | typeof WAIT_FOR_CAPACITY => {
      calls.takes++;
      if (grant === null) return WAIT_FOR_CAPACITY;
      return {
        grant: Math.min(want, grant),
        permits: Math.min(want, grant),
        shrinkTo: () => {},
        release: () => {
          calls.released++;
        },
      };
    },
    running: (workers: number) => {
      calls.running.push(workers);
      return () => {
        calls.ended++;
      };
    },
    refused: () => false,
  } as unknown as TierCapacity;
  return { capacity, calls };
}

function setup(grant: number | null) {
  const store = freshStore();
  stores.push(store);
  liveDaemon(store, WT);
  const at = { now: 1_000_000 };
  const pool = fakePool(grant);
  const report: RunReport = {
    end: "completed",
    durationMs: 1,
    completedFiles: [],
    results: [],
    fileErrors: [],
    failure: null,
  };
  const runs: { workers: number | undefined }[] = [];
  const context = {
    root: "/repo/wt-011-308",
    store,
    sink: createStateSink(store),
    worktreeId: WT,
    policy: DEFAULT_POLICY,
    now: () => at.now,
    note: () => {},
    runsDir: "/repo/.git/squeal/runs",
    hostLoad: () => ({ oneMinute: null, cpus: 1 }),
    capacity: pool.capacity,
    runner: {
      run: (_files: readonly TestFileRef[], options: { workers?: number }) => {
        runs.push({ workers: options.workers });
        return Promise.resolve(report);
      },
    },
    keys: {
      runnerOf: () => undefined,
      runtimeIdentity: () => "",
      writeRuntimeApplications: () => {},
      index: { key: () => null, keysReadAsOne: () => null },
      cache: new StatCache(),
      stabilityPaths: () => [],
      beginRun: () => 1,
      endRun: () => {},
    },
  } as unknown as SchedulerContext;
  return { ledger: new Ledger(context), context, at, calls: pool.calls, runs };
}

/** Queues `paths` as the backlog, or as an edit's work when `recent`, `ms` each. */
function queue(
  ledger: Ledger,
  paths: readonly string[],
  { recent = false, ms = [] as readonly number[] } = {},
): TestFileRef[] {
  return paths.map((path, i) => {
    const ref = { project: "", path };
    const file = ledger.addFile(ref);
    file.key = Buffer.from(path).toString("hex").padEnd(64, "0") as CheckKey;
    file.durationMs = ms[i] ?? null;
    ledger.enqueue(file, recent ? Priority.edited : Priority.transitive, false, recent);
    return ref;
  });
}

const paths = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `test/${prefix}${String(i).padStart(2, "0")}.test.ts`);

/** The tier's kind (`batch` for a batch's), its files' paths and whether it holds a lease. */
function shape(tier: Tier | null) {
  return {
    kind: tier?.promoted === true ? "batch" : (tier?.kind ?? null),
    files: tier?.files.map((f) => f.file.ref.path) ?? [],
    leased: tier?.lease !== undefined,
  };
}

/** The next tier, its run ended before the next selection (no file of it stays running). */
function next(context: SchedulerContext, ledger: Ledger) {
  const tier = selectTier(context, ledger, new Set(), NONE_CUT);
  for (const { file } of tier?.files ?? []) ledger.setRunning(file, null);
  ledger.commit();
  return tier;
}

/** A batch of 6, longest first `w00` at 6 s down to `w05` at 1 s, queued in reverse. */
function sixFileWait(ledger: Ledger, now: number): TestFileRef[] {
  const wait = queue(ledger, paths("w", 6).toReversed(), {
    ms: [1, 2, 3, 4, 5, 6].map((s) => s * 1_000),
  });
  ledger.queue.promote(wait, now + 60_000);
  return wait;
}

describe("a named wait's batch on a busy host (row 011-308)", () => {
  it("with the pool refusing every permit, a 6-file batch starts at once as 4 files, then 2", () => {
    const { ledger, context, at, calls } = setup(null);
    sixFileWait(ledger, at.now);

    const first = next(context, ledger);
    expect(shape(first)).toEqual({ kind: "batch", files: paths("w", 4), leased: false });
    expect(first?.kind).toBe("backlog");
    expect(shape(next(context, ledger))).toEqual({
      kind: "batch",
      files: paths("w", 6).slice(4),
      leased: false,
    });
    // Each tier asked the pool first, as the backlog's does.
    expect(calls.takes).toBe(2);
    expect(next(context, ledger)).toBeNull();
  });

  it("runs the refused batch's tier as an edit's: no grant, its workers stated to the pool", async () => {
    const { ledger, context, at, calls, runs } = setup(null);
    sixFileWait(ledger, at.now);

    const tier = selectTier(context, ledger, new Set(), NONE_CUT);
    expect(tier).not.toBeNull();
    if (tier === null) return;
    await executeTier(context, tier);
    expect(runs).toEqual([{ workers: undefined }]);
    expect(calls.running).toEqual([4]);
    expect(calls.ended).toBe(1);
  });

  it("with the pool granting fewer workers than an edit's tier, returns the grant and starts 4", () => {
    const { ledger, context, at, calls } = setup(3);
    sixFileWait(ledger, at.now);

    expect(shape(next(context, ledger))).toEqual({
      kind: "batch",
      files: paths("w", 4),
      leased: false,
    });
    expect(calls.released).toBe(1);
  });

  it("a grant the wall budget trims below an edit's tier still falls back to 4 (review 0.1.413 B1)", () => {
    const { ledger, context, at, calls } = setup(3);
    // Six files of 500 s: at 3 workers the 600 s budget admits 3, an edit's tier takes 4.
    const wait = queue(ledger, paths("s", 6), { ms: Array(6).fill(500_000) });
    ledger.queue.promote(wait, at.now + 60_000);

    expect(shape(next(context, ledger))).toEqual({
      kind: "batch",
      files: paths("s", 4),
      leased: false,
    });
    expect(calls.takes).toBe(1);
    expect(calls.released).toBe(1);
  });

  it("with the pool granting, the batch runs as one wide tier as before", () => {
    const { ledger, context, at, calls } = setup(8);
    sixFileWait(ledger, at.now);

    const tier = next(context, ledger);
    expect(shape(tier)).toEqual({ kind: "batch", files: paths("w", 6), leased: true });
    expect(tier?.lease?.grant).toBe(6);
    expect(calls.released).toBe(0);
    expect(next(context, ledger)).toBeNull();
  });

  it("an edit queued after the wait runs after the batch's tier", () => {
    const { ledger, context, at } = setup(null);
    sixFileWait(ledger, at.now);
    at.now += 1_000;
    const [edit] = queue(ledger, paths("e", 1), { recent: true });

    expect(shape(next(context, ledger))).toEqual({
      kind: "batch",
      files: paths("w", 4),
      leased: false,
    });
    expect(shape(next(context, ledger)).kind).toBe("batch");
    expect(shape(next(context, ledger))).toEqual({
      kind: "edit",
      files: [edit?.path],
      leased: false,
    });
  });
});
