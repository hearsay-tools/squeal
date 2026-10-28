import { afterEach, describe, expect, it } from "vitest";
import { StatCache } from "../../src/core/hash/index.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { Priority } from "../../src/core/scheduler/queue.js";
import { NONE_CUT } from "../../src/core/scheduler/sharing.js";
import { selectTier } from "../../src/core/scheduler/tiers.js";
import { createStateSink } from "../../src/core/state/index.js";
import {
  type CheckKey,
  DEFAULT_POLICY,
  type RunnerAdapter,
  type Store,
  type TestFileRef,
  type WorktreeId,
} from "../../src/core/types/index.js";
import { liveDaemon } from "../delivery/fakes.js";
import { freshStore } from "../state/helpers.js";

/*
 * Row 011-265 (spec 011 C4 step 5 as amended 2026-10-28): what `selectTier`
 * makes of promoted files (C15) with no edit's work queued. In a lane that
 * runs its backlog in tiers they form a backlog tier of promoted files
 * only, which does not count toward the backlog's turn and which the turn
 * does not go before. A lane that runs its backlog in slots (node:test,
 * pytest) keeps them in an edit's tier of `runner.tierSize` (coordinator,
 * 2026-10-28: a deviation from the probe, which modelled Vitest only).
 * One lane, every file with a key and no result, no pool.
 */

const WT = "wt-011-265" as WorktreeId;
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function setup(runner: Partial<RunnerAdapter> = {}) {
  const store = freshStore();
  stores.push(store);
  liveDaemon(store, WT);
  const at = { now: 1_000_000 };
  const context = {
    root: "/repo/wt-011-265",
    store,
    sink: createStateSink(store),
    worktreeId: WT,
    policy: DEFAULT_POLICY,
    now: () => at.now,
    note: () => {},
    runsDir: "/repo/.git/squeal/runs",
    hostLoad: () => ({ oneMinute: null, cpus: 1 }),
    runner,
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
  return { ledger: new Ledger(context), context, at };
}

/** Queues `paths`, each at a key of its own: an edit's work when `recent`, else the backlog. */
function queue(ledger: Ledger, paths: readonly string[], recent = false): TestFileRef[] {
  return paths.map((path, i) => {
    const ref = { project: "", path };
    const file = ledger.addFile(ref);
    file.key = `${path.length}${i}${recent}`.padEnd(64, "0") as CheckKey;
    ledger.enqueue(file, recent ? Priority.edited : Priority.transitive, false, recent);
    return ref;
  });
}

const paths = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `test/${prefix}${String(i).padStart(2, "0")}.test.ts`);
const pathsOf = (refs: readonly TestFileRef[]) => refs.map((ref) => ref.path);

function picked(context: SchedulerContext, ledger: Ledger, turnDue?: boolean) {
  const tier = selectTier(context, ledger, new Set(), NONE_CUT, turnDue);
  return {
    kind: tier?.kind ?? null,
    promoted: tier?.promoted ?? false,
    files: tier?.files.map((f) => f.file.ref.path).sort() ?? [],
  };
}

describe("selectTier and a tier of promoted files only (row 011-265)", () => {
  it("takes every promoted file in one backlog tier, and none of the backlog", () => {
    const { ledger, context, at } = setup();
    queue(ledger, paths("b", 5));
    const promoted = queue(ledger, paths("p", 10));
    ledger.queue.promote(promoted, at.now + 60_000);

    expect(picked(context, ledger)).toEqual({
      kind: "backlog",
      promoted: true,
      files: pathsOf(promoted),
    });
    expect(picked(context, ledger)).toMatchObject({ kind: "backlog", promoted: false });
  });

  it("does not count toward the backlog's turn, and the turn does not go before it", () => {
    const { ledger, context, at } = setup();
    queue(ledger, paths("b", 5));
    for (let wait = 0; wait < 5; wait += 1) {
      const promoted = queue(ledger, paths(`w${wait}-`, 2));
      ledger.queue.promote(promoted, at.now + 60_000);
      expect(picked(context, ledger).files).toEqual(pathsOf(promoted));
    }
    // On the probe's patch, each counted: the turn came due after four.
    expect(ledger.queue.backlogTurn()).toBe(false);

    const due = queue(ledger, paths("d", 2));
    ledger.queue.promote(due, at.now + 60_000);
    expect(picked(context, ledger, true)).toMatchObject({ kind: "backlog", files: pathsOf(due) });
  });

  it("with an edit's work queued, takes runner.tierSize files as an edit's tier", () => {
    const { ledger, context, at } = setup();
    queue(ledger, paths("b", 5));
    const promoted = queue(ledger, paths("p", 10));
    queue(ledger, ["test/edited.test.ts"], true);
    ledger.queue.promote(promoted, at.now + 60_000);

    expect(picked(context, ledger)).toEqual({
      kind: "edit",
      promoted: false,
      files: pathsOf(promoted).slice(0, DEFAULT_POLICY.runner.tierSize),
    });
  });

  it("a lane that runs its backlog in slots keeps promoted files in an edit's tier", () => {
    const { ledger, context, at } = setup({ backlogSlot: () => 1 });
    queue(ledger, paths("b", 5));
    const promoted = queue(ledger, paths("p", 10));
    ledger.queue.promote(promoted, at.now + 60_000);

    expect(picked(context, ledger)).toEqual({
      kind: "edit",
      promoted: false,
      files: pathsOf(promoted).slice(0, DEFAULT_POLICY.runner.tierSize),
    });
  });
});
