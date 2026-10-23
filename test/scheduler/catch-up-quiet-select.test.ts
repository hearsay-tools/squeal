import { afterEach, describe, expect, it } from "vitest";
import { StatCache } from "../../src/core/hash/index.js";
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
 * Row 011-153 (spec 011 C4 step 5 as amended 2026-10-23,
 * `research/stored-nothing.md` finding 4): a lane whose catch-up of an edit
 * waits for quiet starts no tier of it until 120 s pass with no revision
 * that queues a file of the lane, cancel or not; an edit's tier, a promoted
 * file and the rest of the backlog are not held. One Vitest-like lane,
 * every file with a key and no result.
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

const paths = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `test/${prefix}${i}.test.ts`);
const CATCH_UP = paths("c", 6);
const picked = (context: SchedulerContext, ledger: Ledger) => {
  const tier = selectTier(context, ledger);
  return { kind: tier?.kind ?? null, files: tier?.files.map((f) => f.file.ref.path).sort() ?? [] };
};

describe("selectTier and a lane's wait before catch-up (row 011-153)", () => {
  it("starts no tier of catch-up while the lane's catch-up waits, with no cancel; then one", () => {
    const { ledger, context, quiet, at } = setup();
    queue(ledger, CATCH_UP, "catch-up");
    quiet.caughtUp("", at.now);

    expect(selectTier(context, ledger)).toBeNull();
    expect(ledger.queue.fastSize).toBe(CATCH_UP.length);
    // The pump looks again at least each second while catch-up is held.
    expect(quietSleepMs(context, ledger)).toBe(1_000);

    at.now += CATCHUP_QUIET_MS - 1;
    expect(selectTier(context, ledger)).toBeNull();
    at.now += 1;
    expect(picked(context, ledger)).toEqual({ kind: "backlog", files: CATCH_UP });
  });

  it("runs the rest of the backlog while catch-up waits, and leaves the catch-up queued", () => {
    const { ledger, context, quiet, at } = setup();
    queue(ledger, CATCH_UP, "catch-up");
    const rest = paths("b", 3);
    queue(ledger, rest, "backlog");
    quiet.caughtUp("", at.now);

    expect(picked(context, ledger)).toEqual({ kind: "backlog", files: rest });
    expect(ledger.queue.fastSize).toBe(CATCH_UP.length);
  });

  it("takes an edit's file and a promoted catch-up file at once", () => {
    const { ledger, context, quiet, at } = setup();
    const refs = queue(ledger, CATCH_UP, "catch-up");
    const [edited] = queue(ledger, ["test/edited.test.ts"], "edit");
    quiet.caughtUp("", at.now);

    // An edit's tier of 4 may take catch-up files beside its own, as it takes the backlog's.
    const edit = picked(context, ledger);
    expect(edit.kind).toBe("edit");
    expect(edit.files).toContain(edited?.path);
    expect(selectTier(context, ledger)).toBeNull();

    const left = refs.filter((ref) => ledger.queue.has(ref)).slice(0, 1);
    expect(left).toHaveLength(1);
    ledger.queue.promote(left, at.now + 60_000);
    const promoted = picked(context, ledger);
    expect(promoted.kind).toBe("edit");
    expect(promoted.files).toContain(left[0]?.path);
  });

  it("holds catch-up from the second group's turn, which takes the rest of the backlog", () => {
    const { ledger, context, quiet, at } = setup();
    queue(ledger, CATCH_UP, "catch-up");
    const rest = paths("b", 2);
    queue(ledger, rest, "backlog");
    queue(ledger, paths("e", 2), "edit");
    quiet.caughtUp("", at.now);

    const tier = selectTier(context, ledger, new Set(), undefined, true);
    expect(tier?.kind).toBe("turn");
    const files = tier?.files.map((f) => f.file.ref.path) ?? [];
    expect(files[0]).toBe(rest[0]);
    expect(files.filter((path) => CATCH_UP.includes(path))).toEqual([]);
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
