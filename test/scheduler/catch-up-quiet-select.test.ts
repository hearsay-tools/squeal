import { afterEach, describe, expect, it } from "vitest";
import { StatCache } from "../../src/core/hash/stat-cache.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { Priority } from "../../src/core/scheduler/queue.js";
import {
  BACKLOG_QUIET_MS,
  BacklogQuiet,
  CATCHUP_QUIET_MS,
  publishedQuiet,
  publishedWaits,
  publishQuiet,
  quietMetaKey,
  quietSleepMs,
} from "../../src/core/scheduler/quiet.js";
import { createStateSink } from "../../src/core/state/sink.js";
import type { WorktreeId } from "../../src/core/types/common.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { NO_TRAITS } from "../../src/core/types/runner-traits.js";
import type { Store } from "../../src/core/types/store.js";
import { liveDaemon } from "../delivery/fakes.js";
import { freshStore } from "../state/helpers.js";

/*
 * Row 011-153 (spec 011 C4 step 5 as amended 2026-10-23,
 * `research/stored-nothing.md` finding 4): a lane whose catch-up of an edit
 * waits for quiet starts no tier of it until 120 s pass with no revision
 * that queues a file of the lane, cancel or not; an edit's tier, a promoted
 * file and the rest of the backlog are not held. Here: the wait, the pump's
 * wake while it holds and what it publishes. What the tier plan starts
 * while it waits is `tier-plan-quiet.test.ts`'s (row 011-349).
 */

const WT = "wt-011-153" as WorktreeId;
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
  const context = {
    root: "/repo/wt-011-153",
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
  } as unknown as SchedulerContext;
  return { ledger: new Ledger(context), context, quiet, at };
}

type Group = "edit" | "catch-up" | "backlog";

/** Queues `paths` in `group`, each at a key of its own. */
function queue(ledger: Ledger, paths: readonly string[], group: Group): TestFileRef[] {
  return paths.map((path, i) => {
    const ref = { project: "", path };
    const file = ledger.addFile(ref);
    file.key = `${path.length}${i}${group}`.padEnd(64, "0") as CheckKey;
    const recent = group === "edit";
    const priority = recent ? Priority.edited : Priority.transitive;
    ledger.enqueue(file, priority, false, recent, group === "catch-up");
    return ref;
  });
}

const CATCH_UP = Array.from({ length: 6 }, (_, i) => `test/c${i}.test.ts`);

describe("a lane's wait before catch-up (row 011-153)", () => {
  it("the pump looks again each second while the lane's catch-up is held, and not once it ends", () => {
    const { ledger, context, quiet, at } = setup();
    queue(ledger, CATCH_UP, "catch-up");
    quiet.caughtUp("", at.now);
    expect(quietSleepMs(context, ledger)).toBe(1_000);
    at.now += CATCHUP_QUIET_MS;
    expect(quietSleepMs(context, ledger)).toBeNull();
  });

  it("a revision that queues a file of the lane starts the wait again; a catch-up revision starts none", () => {
    const quiet = new BacklogQuiet();
    // A queue outside a wait starts none: a pull's catch-up runs as before.
    quiet.queued("vitest", T0);
    expect(quiet.catchUpWaits("vitest", T0 + 1)).toBe(false);

    quiet.caughtUp("vitest", T0);
    quiet.queued("node-test", T0 + 60_000);
    expect(quiet.catchUpWaits("vitest", T0 + CATCHUP_QUIET_MS)).toBe(false);

    quiet.caughtUp("vitest", T0);
    quiet.queued("vitest", T0 + 60_000);
    expect(quiet.catchUpWaits("vitest", T0 + CATCHUP_QUIET_MS)).toBe(true);
    expect(quiet.catchUpWaits("vitest", T0 + 60_000 + CATCHUP_QUIET_MS)).toBe(false);
    // The wait after a cancel is apart: catch-up's starts none of it.
    expect(quiet.waits("vitest", T0 + 60_001)).toBe(false);

    quiet.caughtUp("vitest", T0);
    quiet.cancelled("vitest", T0);
    quiet.end(T0 + 1);
    expect(quiet.catchUpWaits("vitest", T0 + 2)).toBe(false);
    expect(quiet.waits("vitest", T0 + 2)).toBe(false);
  });

  it("publishes catch-up's waits beside the others; `publishedQuiet` still reads only the others", () => {
    const store = freshStore();
    stores.push(store);
    const quiet = new BacklogQuiet((ends, now, catchUp) =>
      publishQuiet(store, WT, ends, now, catchUp),
    );
    quiet.caughtUp("vitest", T0);
    expect(publishedWaits(store, WT, T0, T0 + 1)).toEqual({
      backlog: new Map(),
      catchUp: new Map([["vitest", T0 + CATCHUP_QUIET_MS]]),
    });
    expect(publishedQuiet(store, WT, T0, T0 + 1).size).toBe(0);

    quiet.cancelled("vitest", T0 + 10);
    expect(publishedWaits(store, WT, T0, T0 + 11)).toEqual({
      backlog: new Map([["vitest", T0 + 10 + BACKLOG_QUIET_MS]]),
      catchUp: new Map([["vitest", T0 + CATCHUP_QUIET_MS]]),
    });
    // A predecessor's row is none of the live daemon's.
    expect(publishedWaits(store, WT, T0 + 11, T0 + 11).catchUp.size).toBe(0);
    quiet.end(T0 + 12);
    expect(store.meta.get(quietMetaKey(WT))).toBeNull();
  });
});
