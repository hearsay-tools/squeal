import { afterEach, describe, expect, it } from "vitest";
import { StatCache } from "../../src/core/hash/index.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { Priority } from "../../src/core/scheduler/queue.js";
import {
  BACKLOG_QUIET_MS,
  BacklogQuiet,
  publishedQuiet,
  publishQuiet,
  quietMetaKey,
} from "../../src/core/scheduler/quiet.js";
import { selectTier } from "../../src/core/scheduler/tiers.js";
import { createStateSink } from "../../src/core/state/index.js";
import {
  type CheckKey,
  DEFAULT_POLICY,
  type Store,
  type TestFileRef,
  type WorktreeId,
} from "../../src/core/types/index.js";
import { liveDaemon } from "../delivery/fakes.js";
import { freshStore } from "../state/helpers.js";

/*
 * Row 011-94 (spec 011 C4 step 5 as amended 2026-10-21, `tasks/011-82/design.md`
 * row A, the lead): a lane that waits for quiet after its backlog tier's
 * cancel starts no backlog tier; an edit's work in it still runs at once.
 * One Vitest-like lane, every file with a key and no result.
 */

const WT = "wt-011-94" as WorktreeId;
const T0 = 1_000_000;
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function setup(): {
  ledger: Ledger;
  context: SchedulerContext;
  quiet: BacklogQuiet;
  at: { now: number };
} {
  const store = freshStore();
  stores.push(store);
  liveDaemon(store, WT);
  const at = { now: T0 };
  const quiet = new BacklogQuiet();
  const context = {
    root: "/repo/wt-011-94",
    store,
    sink: createStateSink(store),
    worktreeId: WT,
    policy: DEFAULT_POLICY,
    now: () => at.now,
    note: () => {},
    runsDir: "/repo/.git/squeal/runs",
    hostLoad: () => ({ oneMinute: null, cpus: 1 }),
    runner: {},
    keys: {
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

/** Queues `paths`, each at a key of its own; `recent` ones as an edit's work. */
function queue(ledger: Ledger, paths: readonly string[], recent = false): TestFileRef[] {
  return paths.map((path, i) => {
    const ref = { project: "", path };
    const file = ledger.addFile(ref);
    file.key = `${path.length}${i}${recent ? "r" : "b"}`.padEnd(64, "0") as CheckKey;
    ledger.enqueue(file, recent ? Priority.edited : Priority.neverRun, false, recent);
    return ref;
  });
}

const BACKLOG = Array.from({ length: 6 }, (_, i) => `test/b${i}.test.ts`);

describe("selectTier and a lane's wait for quiet (row 011-94)", () => {
  it("starts no backlog tier in a lane that waits, and one once the wait ends", () => {
    const { ledger, context, quiet, at } = setup();
    queue(ledger, BACKLOG);
    quiet.cancelled("", at.now);

    expect(selectTier(context, ledger)).toBeNull();
    expect(ledger.queue.fastSize).toBe(BACKLOG.length);

    at.now += BACKLOG_QUIET_MS;
    const tier = selectTier(context, ledger);
    expect(tier?.kind).toBe("backlog");
    expect(tier?.files.map((f) => f.file.ref.path).sort()).toEqual(BACKLOG);
  });

  it("takes an edit's file at once in a lane that waits, and leaves the backlog's queued", () => {
    const { ledger, context, quiet, at } = setup();
    queue(ledger, BACKLOG);
    const [edited] = queue(ledger, ["test/edited.test.ts"], true);
    quiet.cancelled("", at.now);

    const tier = selectTier(context, ledger);
    expect(tier?.kind).toBe("edit");
    expect(tier?.files.map((f) => f.file.ref.path)).toContain(edited?.path);
    // The edit's tier of 4 may take backlog files beside it, as before; the rest stay queued.
    expect(ledger.queue.fastSize).toBeGreaterThan(0);
  });

  it("a revision that queues a file of the lane starts the wait again; another lane's does not", () => {
    const quiet = new BacklogQuiet();
    quiet.cancelled("vitest", T0);
    quiet.queued("node-test", T0 + 15_000);
    expect(quiet.waits("vitest", T0 + BACKLOG_QUIET_MS)).toBe(false);

    quiet.cancelled("vitest", T0);
    quiet.queued("vitest", T0 + 15_000);
    expect(quiet.waits("vitest", T0 + BACKLOG_QUIET_MS)).toBe(true);
    expect(quiet.waits("vitest", T0 + 15_000 + BACKLOG_QUIET_MS)).toBe(false);
    // No wait, nothing to start again: a queue outside a wait starts none.
    quiet.queued("vitest", T0 + 40_000);
    expect(quiet.waits("vitest", T0 + 40_001)).toBe(false);
  });

  it("publishes each wait's end for status, and a row older than the daemon is not its own", () => {
    const store = freshStore();
    stores.push(store);
    const quiet = new BacklogQuiet((ends, now) => publishQuiet(store, WT, ends, now));
    quiet.cancelled("", T0);
    expect(publishedQuiet(store, WT, T0, T0 + 1)).toEqual(new Map([["", T0 + BACKLOG_QUIET_MS]]));
    expect(publishedQuiet(store, WT, T0 + 1, T0 + 1).size).toBe(0);
    expect(publishedQuiet(store, WT, T0, T0 + BACKLOG_QUIET_MS).size).toBe(0);
    quiet.end(T0 + 5);
    expect(store.meta.get(quietMetaKey(WT))).toBeNull();
  });
});
