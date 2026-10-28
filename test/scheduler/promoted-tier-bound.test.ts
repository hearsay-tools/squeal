import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatCache } from "../../src/core/hash/index.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { Priority } from "../../src/core/scheduler/queue.js";
import type { Tier } from "../../src/core/scheduler/tiers.js";
import { publishedYieldRow, TierYields } from "../../src/core/scheduler/yields.js";
import {
  type CheckKey,
  DEFAULT_POLICY,
  type RelativePath,
  type Store,
  type WorktreeId,
} from "../../src/core/types/index.js";
import { freshStore } from "../state/helpers.js";

/*
 * Review `reviews/0.1.377.md` B1, rule 3 (row 011-265): a tier of promoted
 * files only that something waits for is decided again at the deadline of
 * its files' open promotion, whatever it stood on; with none open, an
 * edit's work cancels it as any backlog tier. Fake timers, as
 * `tier-yields-bound.test.ts`. P is the tier's running file, promoted by an
 * earlier wait for `OPEN_MS`; Q is an edit's file a later wait named, of
 * P's duration, so the cut would take it in P's next tier at once
 * (`startsSooner`): it counts, and the 20 s remainder lets the tier run on.
 */
const WT = "wt-0.1.377-b1" as WorktreeId;
const OPEN_MS = 10_000;
const MS = 20_000;
const stores: Store[] = [];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  for (const store of stores.splice(0)) store.close();
});

function setup() {
  const store = freshStore();
  stores.push(store);
  const context = {
    store,
    worktreeId: WT,
    policy: DEFAULT_POLICY,
    now: () => Date.now(),
    runner: {},
    keys: { cache: new StatCache(), isEnvironmentInput: () => false, runnerOf: () => undefined },
  } as unknown as SchedulerContext;
  const ledger = new Ledger(context);
  const p = ledger.addFile({ project: "", path: "test/p.test.ts" });
  p.key = "p".padEnd(64, "0") as CheckKey;
  p.durationMs = MS;
  ledger.setRunning(p, p.key);
  ledger.queue.promote([p.ref], Date.now() + OPEN_MS);
  const q = ledger.addFile({ project: "", path: "test/q.test.ts" });
  q.key = "q".padEnd(64, "0") as CheckKey;
  q.durationMs = MS;
  ledger.enqueue(q, Priority.edited, false, true, false, 2);
  ledger.queue.promote([q.ref], Date.now() + 600_000);
  const tier = {
    runId: "run-p",
    lane: "",
    kind: "backlog",
    promoted: true,
    files: [
      {
        file: p,
        key: p.key,
        inputs: [p.ref.path as RelativePath],
        checkpointId: null,
        forced: false,
      },
    ],
    changes: new Set(),
    revision: { number: 1 },
    startedAt: Date.now(),
    cancel: new AbortController(),
  } as unknown as Tier;
  return { store, context, ledger, tier };
}

describe("a promoted-only tier is decided again when its files' open promotion ends (review 0.1.377 B1)", () => {
  it("standing on its remainder, it is cancelled for the edit's work at P's deadline, not 30 s past its estimate", () => {
    const { store, context, ledger, tier } = setup();
    const yields = new TierYields(() => yields.check(context, ledger, [tier], null));

    yields.check(context, ledger, [tier], null);
    expect([...publishedYieldRow(store, WT, 0).tiers.values()]).toEqual([
      { kind: "remainder", remainderMs: MS },
    ]);
    vi.advanceTimersByTime(OPEN_MS - 1);
    expect(tier.cancel?.signal.aborted).toBe(false);

    // On the first repair without the bound: checked again only at 50 s, its remainder's bound.
    vi.advanceTimersByTime(1);
    expect(tier.cancel?.signal.reason).toBe("backlog");
  });
});
