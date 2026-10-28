import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatCache } from "../../src/core/hash/index.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import type { FileState } from "../../src/core/scheduler/files.js";
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
 * Review `reviews/0.1.377.md` B1 and S1 (row 011-265), with fake timers as
 * `tier-yields-bound.test.ts`: a tier of promoted files only is decided
 * again at the deadline of its files' open promotion, whatever it stood
 * on; with none open, it is a backlog tier as any. It has its rank to beat
 * from its start (coordinator, reply to request 8b69856d), so before 30 s a
 * later wait's file does not cut it while the earlier wait is open. P is
 * the tier's running file, promoted for `OPEN_MS`; Q is queued, promoted by
 * another wait for 600 s, of P's duration, so the cut would take it in P's
 * next tier at once (`startsSooner`).
 */
const WT = "wt-0.1.377-b1" as WorktreeId;
const OPEN_MS = 10_000;
const stores: Store[] = [];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  for (const store of stores.splice(0)) store.close();
});

interface Setup {
  /** P's and Q's last-known duration. */
  readonly ms: number;
  /** Q's wait came first. */
  readonly qFirst: boolean;
  /** Q is an edit's work, queued after the tier's revision. */
  readonly qEdit: boolean;
  /** The tier is a promoted-only tier, else an edit's tier. */
  readonly promoted: boolean;
}

function setup({ ms, qFirst, qEdit, promoted }: Setup) {
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
  const fileOf = (path: string): FileState => {
    const file = ledger.addFile({ project: "", path });
    file.key = path.padEnd(64, "0") as CheckKey;
    file.durationMs = ms;
    return file;
  };
  const p = fileOf("test/p.test.ts");
  ledger.setRunning(p, p.key);
  const q = fileOf("test/q.test.ts");
  ledger.enqueue(q, qEdit ? Priority.edited : Priority.transitive, false, qEdit, false, 2);
  const promoteP = () => ledger.queue.promote([p.ref], Date.now() + OPEN_MS);
  const promoteQ = () => ledger.queue.promote([q.ref], Date.now() + 600_000);
  if (qFirst) promoteQ();
  promoteP();
  if (!qFirst) promoteQ();
  const tier = {
    runId: "run-p",
    lane: "",
    kind: promoted ? "backlog" : "edit",
    ...(promoted ? { promoted: true } : {}),
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
  const yields = new TierYields(() => yields.check(context, ledger, [tier], null));
  const standing = () => [...publishedYieldRow(store, WT, 0).tiers.values()];
  return { check: () => yields.check(context, ledger, [tier], null), standing, tier };
}

describe("a promoted-only tier, its files' open promotion and the waits beside it (review 0.1.377 B1, S1)", () => {
  it("standing on its remainder, it is cancelled for the edit's work at P's deadline, not 30 s past its estimate", () => {
    // Q is an edit's file of an earlier wait: it ranks before P and counts.
    const { check, standing, tier } = setup({
      ms: 20_000,
      qFirst: true,
      qEdit: true,
      promoted: true,
    });
    check();
    expect(standing()).toEqual([{ kind: "remainder", remainderMs: 20_000 }]);
    vi.advanceTimersByTime(OPEN_MS - 1);
    expect(tier.cancel?.signal.aborted).toBe(false);

    // On the first repair without the bound: checked again only at 50 s, its remainder's bound.
    vi.advanceTimersByTime(1);
    expect(tier.cancel?.signal.reason).toBe("backlog");
  });

  it("before 30 s, a later wait's file does not cut it while P's wait is open; at P's deadline it does", () => {
    const { check, standing, tier } = setup({
      ms: 45_000,
      qFirst: false,
      qEdit: false,
      promoted: true,
    });
    check();
    // On 43e456cd9: the cut took Q in P's next tier, so it yielded with a 45 s remainder.
    expect(tier.cancel?.signal.aborted).toBe(false);
    expect(standing()).toEqual([{ kind: "named" }]);
    vi.advanceTimersByTime(OPEN_MS - 1);
    expect(tier.cancel?.signal.aborted).toBe(false);

    vi.advanceTimersByTime(1);
    expect(tier.cancel?.signal.reason).toBe("yield");
  });

  it("an edit's tier of the same files yields to the later wait's file at once (row 011-263, unchanged)", () => {
    const { check, tier } = setup({ ms: 45_000, qFirst: false, qEdit: false, promoted: false });
    check();
    expect(tier.cancel?.signal.reason).toBe("yield");
  });
});
