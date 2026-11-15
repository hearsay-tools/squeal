import { afterEach, describe, expect, it, vi } from "vitest";
import { StatCache } from "../../src/core/hash/stat-cache.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { decideYields } from "../../src/core/scheduler/decide-yields.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { Priority } from "../../src/core/scheduler/queue.js";
import type { Tier } from "../../src/core/scheduler/tiers.js";
import { TierYields } from "../../src/core/scheduler/yields.js";
import type { EpochMs, RelativePath, WorktreeId } from "../../src/core/types/common.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { NO_TRAITS } from "../../src/core/types/runner-traits.js";
import type { Store } from "../../src/core/types/store.js";
import { freshStore } from "../state/helpers.js";

/*
 * Row 011-361 (review `reviews/0.1.514-r2.md` N1): `TierYields.check`
 * decides, then applies the claim bookkeeping its decision read. Another
 * worktree's commit can land between the two: the scheduler's lock does not
 * hold another process's SQLite writer. `afterDecide` runs that commit, as
 * a hook between `decideYields` and the apply.
 */

let afterDecide: (() => void) | null = null;

vi.mock("../../src/core/scheduler/decide-yields.js", async (original) => {
  const actual = await original<typeof import("../../src/core/scheduler/decide-yields.js")>();
  return {
    ...actual,
    decideYields: (...args: Parameters<typeof actual.decideYields>) => {
      const decided = actual.decideYields(...args);
      const hook = afterDecide;
      afterDecide = null;
      hook?.();
      return decided;
    },
  };
});

const S = 1_000;
const T = 1_800_000_000_000 as EpochMs;
/** `claimBoundMs(DEFAULT_POLICY.runner.timeoutMs)`: the waiter's bound on one claim. */
const BOUND = 606_000;
const KEY = "c".padEnd(64, "0") as CheckKey;
const stores: Store[] = [];

afterEach(() => {
  afterDecide = null;
  for (const store of stores.splice(0)) store.close();
});

/**
 * Another worktree whose daemon beats for the whole test: its claim of
 * `KEY` is a real `test_file_keys` row, `pending` `running` or `queued`.
 */
function worktree(store: Store, id: string) {
  const worktreeId = id as WorktreeId;
  store.worktrees.upsert({
    id: worktreeId,
    root: `/tmp/${id}`,
    commonDir: `/tmp/${id}/.git`,
    isMain: false,
    registeredAt: T,
    daemon: {
      socketPath: `/tmp/squeal-${id}.sock`,
      startedAt: T,
      heartbeatAt: T,
      heartbeatIntervalMs: 10 * BOUND,
      squealVersion: "0.0.0-test",
    },
  });
  const testFile = { project: "", path: "test/claimed.test.ts" };
  return (pending: "running" | "queued") =>
    store.testFileKeys.upsertMany([{ worktreeId, testFile, key: KEY, revision: 1, pending }]);
}

/**
 * A ledger whose one queued file, promoted and not an edit's work, has key
 * `KEY`, on a store two other worktrees share: `a` and `b` claim it or end
 * their claim. A tier in flight since `T` of one 5 s file.
 */
function world() {
  const store = freshStore();
  stores.push(store);
  const a = worktree(store, "wt-a");
  const b = worktree(store, "wt-b");
  const clock = { now: T };
  const context = {
    store,
    worktreeId: "wt-011-361" as WorktreeId,
    policy: DEFAULT_POLICY,
    now: () => clock.now,
    runner: { traits: NO_TRAITS },
    keys: { cache: new StatCache(), isEnvironmentInput: () => false, runnerOf: () => undefined },
  } as unknown as SchedulerContext;
  const ledger = new Ledger(context);
  const ref = { project: "", path: "test/claimed.test.ts" };
  const file = ledger.addFile(ref);
  file.key = KEY;
  ledger.enqueue(file, Priority.edited, false, false);
  ledger.queue.promote([ref], T + 10 * BOUND);
  const run = ledger.addFile({ project: "", path: "test/a.test.ts" });
  run.key = "run-a0".padEnd(64, "0") as CheckKey;
  run.durationMs = 5 * S;
  const tier = {
    runId: "run-a",
    lane: "",
    kind: "edit",
    files: [
      {
        file: run,
        key: run.key,
        inputs: ["test/a.test.ts" as RelativePath],
        checkpointId: null,
        forced: false,
      },
    ],
    changes: new Set(),
    revision: { number: 1 },
    startedAt: T,
    cancel: new AbortController(),
  } as unknown as Tier;
  const yields = new TierYields();
  /** One check at `at`; `between` commits between the decision and the apply. */
  const check = (at: number, between?: () => void) => {
    clock.now = at;
    if (between !== undefined) afterDecide = between;
    yields.check(context, ledger, [tier], null);
  };
  /** What a decision at `at` decides for the tier, not cancelled, the store as it is. */
  const decides = (at: number) =>
    decideYields(at as EpochMs, null, {
      context,
      ledger,
      tiers: [{ ...tier, cancel: new AbortController() }],
      marks: new Map(),
      standing: new Map(),
      held: false,
    })?.tiers[0]?.decision;
  return { a, b, check, decides, ledger, yields };
}

describe("the yield check applies the claim facts its decision read (row 011-361)", () => {
  it(
    "a claim that ends before the decision and a new one before the apply: " +
      "the new claim's bound starts at the decision, not at the old claim's first sight",
    () => {
      const raced = world();
      // T: worktree a's claim, first seen here.
      raced.a("running");
      raced.check(T);
      // T + 500 s: a's tier was cancelled and the decision reads no claim; b claims before the apply.
      raced.a("queued");
      raced.check(T + 500 * S, () => raced.b("running"));
      // T + 606,001 ms: a's bound has passed; b's, begun at T + 500 s at the earliest, has not.
      const at = T + BOUND + 1;
      expect(raced.decides(at)).toEqual({ kind: "recheck" });
      expect(raced.ledger.claims.holds(KEY, at as EpochMs)).toBe(true);
      raced.yields.close();
    },
  );

  it("the same claims committed after the check: b's bound starts at its next read", () => {
    const after = world();
    after.a("running");
    after.check(T);
    after.a("queued");
    after.check(T + 500 * S);
    after.b("running");
    const at = T + BOUND + 1;
    expect(after.decides(at)).toEqual({ kind: "recheck" });
    after.yields.close();
  });

  it("a claim the decision read that ends before the apply: the decision's fact, then the next read's", () => {
    const raced = world();
    raced.a("running");
    raced.check(T);
    raced.ledger.claims.begin();
    raced.check(T + 500 * S, () => raced.a("queued"));
    // The decision read a's claim: the apply records that, and the waiting flag is set as it implied.
    expect(raced.ledger.claims.waiting).toBe(true);
    // The next read sees it gone and drops its first sight: a later claim starts a new bound.
    expect(raced.ledger.claims.holds(KEY, (T + 501 * S) as EpochMs)).toBe(false);
    raced.b("running");
    expect(raced.decides(T + BOUND + 1)).toEqual({ kind: "recheck" });
    raced.yields.close();
  });
});
