import { afterEach, describe, expect, it } from "vitest";
import { StatCache } from "../../src/core/hash/stat-cache.js";
import type { TierCapacity } from "../../src/core/scheduler/capacity.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { Priority } from "../../src/core/scheduler/queue.js";
import {
  BacklogQuiet,
  CATCHUP_QUIET_MS,
  QUIET_DEMAND_FILES,
  QUIET_DEMAND_LEAD_MS,
  quietDemand,
} from "../../src/core/scheduler/quiet.js";
import type { CutFiles } from "../../src/core/scheduler/sharing.js";
import { liveView } from "../../src/core/scheduler/tier-live.js";
import { createStateSink } from "../../src/core/state/sink.js";
import type { EpochMs, WorktreeId } from "../../src/core/types/common.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { NO_TRAITS } from "../../src/core/types/runner-traits.js";
import type { Store } from "../../src/core/types/store.js";
import { liveDaemon } from "../delivery/fakes.js";
import { freshStore } from "../state/helpers.js";

/*
 * Row 011-424 (spec 011 C4 step 5 and C10 as amended): while a lane's wait
 * for catch-up holds files and ends within 30 s, each look at the waits
 * states them, at most 64, in the pool mark (`TierCapacity.expectBacklog`).
 * An edit that starts the wait again withdraws them at the next look, and
 * so does the wait's end. The pool's side is
 * `test/capacity/quiet-demand.test.ts`.
 */

const WT = "wt-011-424" as WorktreeId;
const T0 = 1_000_000;
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function setup() {
  const store = freshStore();
  stores.push(store);
  liveDaemon(store, WT);
  const at = { now: T0 };
  const quiet = new BacklogQuiet();
  const stated: number[] = [];
  const capacity = { expectBacklog: (files: number) => stated.push(files) };
  const context = {
    root: "/repo/wt-011-424",
    store,
    sink: createStateSink(store),
    worktreeId: WT,
    policy: DEFAULT_POLICY,
    now: () => at.now,
    note: () => {},
    runsDir: "/repo/.git/squeal/runs",
    hostLoad: () => ({ oneMinute: null, cpus: 1 }),
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
    quiet,
    capacity: capacity as unknown as TierCapacity,
  } as unknown as SchedulerContext;
  const ledger = new Ledger(context);
  /** One pump look at the waits, as the tier plan's idle answer makes it; what it stated. */
  const look = (): number | undefined => {
    const view = liveView(context, ledger, {
      busy: () => new Set(),
      cut: { cutPastEstimate: () => false } as unknown as CutFiles,
    });
    view.quietWakeMs(at.now as EpochMs);
    return stated.at(-1);
  };
  return { ledger, context, quiet, at, look };
}

/** Queues `count` files, as catch-up or as an edit's, each at a key of its own. */
function queue(ledger: Ledger, count: number, catchUp: boolean, prefix = "c"): TestFileRef[] {
  return Array.from({ length: count }, (_, i) => {
    const ref = { project: "", path: `test/${prefix}${i}.test.ts` };
    const file = ledger.addFile(ref);
    file.key = `${prefix}${i}`.padEnd(64, "0") as CheckKey;
    ledger.enqueue(file, catchUp ? Priority.transitive : Priority.edited, false, !catchUp, catchUp);
    return ref;
  });
}

describe("a wait for catch-up states its demand in its last 30 s (row 011-424)", () => {
  it("states nothing until 30 s before the end, then the held files, and nothing once it ends", () => {
    const { ledger, quiet, at, look } = setup();
    queue(ledger, 6, true);
    quiet.caughtUp("", at.now);
    expect(look()).toBe(0);
    at.now += CATCHUP_QUIET_MS - QUIET_DEMAND_LEAD_MS - 1;
    expect(look()).toBe(0);
    at.now += 1;
    expect(look()).toBe(6);
    at.now += QUIET_DEMAND_LEAD_MS;
    expect(look()).toBe(0);
  });

  it("an edit that queues a file of the lane withdraws it at the next look", () => {
    const { ledger, quiet, at, look } = setup();
    queue(ledger, 6, true);
    quiet.caughtUp("", at.now);
    at.now += CATCHUP_QUIET_MS - 10_000;
    expect(look()).toBe(6);
    queue(ledger, 1, false, "e");
    quiet.queued("", at.now);
    expect(look()).toBe(0);
  });

  it("states at most 64 files, and counts only the files the wait holds", () => {
    const { ledger, context, quiet, at } = setup();
    queue(ledger, 80, true);
    queue(ledger, 5, false, "e");
    quiet.caughtUp("", at.now);
    at.now += CATCHUP_QUIET_MS - 1_000;
    expect(quietDemand(context, ledger, at.now as EpochMs)).toBe(QUIET_DEMAND_FILES);
  });

  it("the wait after a cancel, 20 s, states nothing", () => {
    const { ledger, context, quiet, at } = setup();
    queue(ledger, 6, true);
    quiet.cancelled("", at.now);
    expect(quietDemand(context, ledger, at.now as EpochMs)).toBe(0);
  });
});
