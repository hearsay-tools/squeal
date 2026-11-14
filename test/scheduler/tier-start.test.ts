import { afterEach, describe, expect, it } from "vitest";
import type { PoolLease } from "../../src/core/capacity/pool.js";
import { StatCache } from "../../src/core/hash/stat-cache.js";
import { type TierCapacity, WAIT_FOR_CAPACITY } from "../../src/core/scheduler/capacity.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { Priority } from "../../src/core/scheduler/queue.js";
import type { Candidate, GrantAsk, Idle, TierPlan } from "../../src/core/scheduler/tier-plan.js";
import { startNext } from "../../src/core/scheduler/tier-start.js";
import type { Tier, TierFile } from "../../src/core/scheduler/tiers.js";
import { createStateSink } from "../../src/core/state/sink.js";
import type { EpochMs, WorktreeId } from "../../src/core/types/common.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { NO_TRAITS } from "../../src/core/types/runner-traits.js";
import type { Store } from "../../src/core/types/store.js";
import { liveDaemon } from "../delivery/fakes.js";
import { freshStore } from "../state/helpers.js";

/*
 * Row 011-346: the tier plan's act step, `startNext`, over a real `Ledger`
 * and a fake pool, with a plan that answers from a list and logs what the
 * act step told it.
 */

const WT = "wt-011-346" as WorktreeId;
const NOW = 1_000_000 as EpochMs;
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

/** A pool that grants up to `grant` workers, or refuses with `null`, and counts releases. */
function fakePool(grant: number | null) {
  const calls = { takes: [] as number[], released: 0 };
  const capacity = {
    take: (want: number): PoolLease | typeof WAIT_FOR_CAPACITY => {
      calls.takes.push(want);
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
  } as unknown as TierCapacity;
  return { capacity, calls };
}

function setup(grant: number | null) {
  const store = freshStore();
  stores.push(store);
  liveDaemon(store, WT);
  const pool = fakePool(grant);
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
    runner: { traits: NO_TRAITS },
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
  return { context, ledger, calls: pool.calls, files };
}

/** A grant ask whose `atGrant` keeps `fits(grant)` files, narrower below `least`. */
function ask(files: readonly TierFile[], narrowerBelow = 0): GrantAsk {
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

function candidate(files: readonly TierFile[], over: Partial<Candidate> = {}): Candidate {
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

const IDLE: Idle = { idle: "lane-busy", at: NOW, wakeAt: null };

/** A plan that answers each outcome with the next of `steps` and logs it. */
function listPlan(steps: readonly (Candidate | Idle)[]): TierPlan & { log: string[] } {
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

const paths = (result: { tier: Tier } | { idle: Idle }) =>
  "tier" in result ? result.tier.files.map((f) => f.file.ref.path) : result.idle.idle;

describe("the tier plan's act step (row 011-346)", () => {
  it("takes the grant and starts the candidate holding the lease", () => {
    const { context, ledger, calls, files } = setup(8);
    const result = startNext(context, ledger, listPlan([candidate(files("a", "b", "c"))]));
    expect(paths(result)).toEqual(["a", "b", "c"]);
    expect("tier" in result && result.tier.lease?.grant).toBe(3);
    expect(calls).toEqual({ takes: [3], released: 0 });
  });

  it("a lower grant trims the candidate to the prefix that fits; the rest stays queued", () => {
    const { context, ledger, files } = setup(2);
    const picked = files("a", "b", "c");
    const result = startNext(context, ledger, listPlan([candidate(picked)]));
    expect(paths(result)).toEqual(["a", "b"]);
    expect(ledger.queue.has({ project: "", path: "c" })).toBe(true);
  });

  it("a grant narrower than an edit's tier goes back and the plan's next candidate starts", () => {
    const { context, ledger, calls, files } = setup(2);
    const picked = files("a", "b", "c", "d");
    const plan = listPlan([
      candidate(picked, { width: ask(picked, 4), promoted: true, counts: "batch" }),
      candidate(picked, { reason: "batch-as-edit", width: null, promoted: true, counts: "batch" }),
    ]);
    const result = startNext(context, ledger, plan);
    expect(paths(result)).toEqual(["a", "b", "c", "d"]);
    expect("tier" in result && result.tier.lease).toBeUndefined();
    expect(plan.log).toEqual(["refused narrower"]);
    expect(calls.released).toBe(1);
  });

  it("a refusal takes the next candidate; with none, the answer is the pool's", () => {
    const { context, ledger, files } = setup(null);
    const plan = listPlan([candidate(files("a")), IDLE]);
    const result = startNext(context, ledger, plan);
    expect("idle" in result && result.idle).toEqual({ idle: "pool", at: NOW, wakeAt: NOW + 2_000 });
    expect(plan.log).toEqual(["refused pool"]);
  });

  it("a claim or a wait for quiet the plan answers comes before the pool's refusal", () => {
    const { context, ledger, files } = setup(null);
    const quiet: Idle = { idle: "quiet", at: NOW, wakeAt: (NOW + 300) as EpochMs };
    const result = startNext(context, ledger, listPlan([candidate(files("a")), quiet]));
    expect("idle" in result && result.idle).toEqual(quiet);
  });

  it("the lease goes back when the start throws", () => {
    const { context, ledger, calls, files } = setup(8);
    const picked = files("a");
    context.store.transaction = () => {
      throw new Error("database is locked");
    };
    expect(() => startNext(context, ledger, listPlan([candidate(picked)]))).toThrow(/locked/);
    expect(calls.released).toBe(1);
  });

  it("a start the lookup settled meanwhile asks the plan again", () => {
    const { context, ledger, calls, files } = setup(8);
    const picked = files("a").map((f) => ({ ...f, forced: false }));
    ledger.probe = () => ({ hits: [{} as never], mayWait: false });
    ledger.applyResults = (file) => {
      ledger.queue.remove(file.ref);
    };
    const plan = listPlan([candidate(picked)]);
    const result = startNext(context, ledger, plan);
    expect(paths(result)).toBe("lane-busy");
    expect(plan.log).toEqual(["unstarted a"]);
    expect(calls.released).toBe(1);
  });

  it("checks the lock turn before each start; with fly, flies each and goes on after a slot", () => {
    const { context, ledger, files } = setup(8);
    const [a, b] = [files("a"), files("b")];
    const checked: string[] = [];
    const flown: string[] = [];
    const plan = listPlan([candidate(a ?? []), candidate(b ?? [])]);
    const result = startNext(context, ledger, plan, {
      check: (lane) => checked.push(lane),
      fly: (tier) => flown.push(tier.files[0]?.file.ref.path ?? ""),
    });
    expect(paths(result)).toEqual(["a"]);
    expect([checked, flown]).toEqual([
      ["fast", "fast"],
      ["a", "b"],
    ]);
    expect(plan.log).toEqual(["started a", "started b"]);
  });
});
