import type { PoolLease } from "../../src/core/capacity/pool.js";
import { StatCache } from "../../src/core/hash/stat-cache.js";
import { type TierCapacity, WAIT_FOR_CAPACITY } from "../../src/core/scheduler/capacity.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { Priority } from "../../src/core/scheduler/queue.js";
import type { Candidate, GrantAsk, Idle, TierPlan } from "../../src/core/scheduler/tier-plan.js";
import type { Tier, TierFile } from "../../src/core/scheduler/tiers.js";
import { createStateSink } from "../../src/core/state/sink.js";
import type { EpochMs, WorktreeId } from "../../src/core/types/common.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import type { RunReport } from "../../src/core/types/runner.js";
import { NO_TRAITS } from "../../src/core/types/runner-traits.js";
import type { Store } from "../../src/core/types/store.js";
import { liveDaemon } from "../delivery/fakes.js";
import { freshStore } from "../state/helpers.js";

/*
 * Rows 011-346 and 011-349: the act step's fixture, a real `Ledger` and a
 * fake pool, with a plan that answers from a list and logs what the act
 * step told it.
 */

const REPORT: RunReport = {
  end: "completed",
  durationMs: 1,
  completedFiles: [],
  results: [],
  fileErrors: [],
  failure: null,
};

const WT = "wt-011-346" as WorktreeId;
export const NOW = 1_000_000 as EpochMs;
const stores: Store[] = [];

/** Closes the stores `setup` opened: each test file's `afterEach`. */
export function closeStores(): void {
  for (const store of stores.splice(0)) store.close();
}

/**
 * A pool that grants up to `grant` workers, or refuses with `null`; it
 * counts releases, logs the lane and `refusalWaits` of each take, and the
 * workers an unleased tier states while it runs (`running`).
 */
function fakePool(grant: number | null) {
  const calls = {
    takes: [] as number[],
    released: 0,
    asked: [] as { waitsIn: string | null; refusalWaits: boolean }[],
    running: [] as number[],
  };
  const capacity = {
    take: (
      want: number,
      _pool: string,
      _least: number,
      _kind: string,
      waitsIn: string | null = null,
      refusalWaits = true,
    ): PoolLease | typeof WAIT_FOR_CAPACITY => {
      calls.takes.push(want);
      calls.asked.push({ waitsIn, refusalWaits });
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
      return () => {};
    },
  } as unknown as TierCapacity;
  return { capacity, calls };
}

/** A ledger on a fresh store with a pool of `grant`; `runs` logs the workers each run was given. */
export function setup(grant: number | null) {
  const store = freshStore();
  stores.push(store);
  liveDaemon(store, WT);
  const pool = fakePool(grant);
  const runs: (number | undefined)[] = [];
  const context = {
    root: "/repo/wt-011-346",
    store,
    sink: createStateSink(store),
    worktreeId: WT,
    policy: DEFAULT_POLICY,
    now: () => NOW,
    note: () => {},
    runsDir: "/repo/.git/squeal/runs",
    hostLoad: () => ({ oneMinute: null, cpus: 1 }),
    capacity: pool.capacity,
    runner: {
      traits: NO_TRAITS,
      run: (_files: readonly TestFileRef[], options: { workers?: number }) => {
        runs.push(options.workers);
        return Promise.resolve(REPORT);
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
  const ledger = new Ledger(context);
  /** Queued files of the backlog as a tier's files. */
  const files = (...paths: string[]): TierFile[] =>
    paths.map((path) => {
      const ref: TestFileRef = { project: "", path };
      const file = ledger.addFile(ref);
      file.key = Buffer.from(path).toString("hex").padEnd(64, "0") as CheckKey;
      ledger.enqueue(file, Priority.transitive, false, false);
      return {
        file,
        key: file.key,
        inputs: [],
        runtimePolicy: "",
        checkpointId: null,
        forced: true,
      };
    });
  return { context, ledger, calls: pool.calls, files, runs };
}

/** A grant ask whose `atGrant` keeps `fits(grant)` files, narrower below `least`. */
export function ask(files: readonly TierFile[], narrowerBelow = 0): GrantAsk {
  return {
    want: files.length,
    least: 1,
    offer: files.length,
    kind: "backlog",
    lane: "fast",
    refusalWaits: true,
    atGrant: (grant) => ({ files: files.slice(0, grant), narrower: grant < narrowerBelow }),
  };
}

export function candidate(files: readonly TierFile[], over: Partial<Candidate> = {}): Candidate {
  return {
    reason: "backlog",
    kind: "backlog",
    lane: "fast",
    files,
    focus: null,
    width: ask(files),
    promoted: false,
    beside: false,
    counts: "tier",
    tookBacklog: true,
    estimateMs: 0,
    ...over,
  };
}

export const IDLE: Idle = { idle: "lane-busy", at: NOW, wakeAt: null };

/** A plan that answers each outcome with the next of `steps` and logs it. */
export function listPlan(steps: readonly (Candidate | Idle)[]): TierPlan & { log: string[] } {
  const log: string[] = [];
  let at = 0;
  const next = () => steps[++at] ?? IDLE;
  return {
    log,
    first: steps[0] ?? IDLE,
    afterRefusal: (refused = "pool") => {
      log.push(`refused ${refused}`);
      return next();
    },
    afterUnstarted: (files) => {
      log.push(`unstarted ${files.map((f) => f.file.ref.path).join(",")}`);
      return next();
    },
    afterStart: (tier: Tier) => {
      log.push(`started ${tier.files.map((f) => f.file.ref.path).join(",")}`);
      return at + 1 < steps.length ? next() : null;
    },
  };
}

export const paths = (result: { tier: Tier } | { idle: Idle }) =>
  "tier" in result ? result.tier.files.map((f) => f.file.ref.path) : result.idle.idle;
