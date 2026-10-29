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
  type Store,
  type TestFileRef,
  type WorktreeId,
} from "../../src/core/types/index.js";
import { liveDaemon } from "../delivery/fakes.js";
import { freshStore } from "../state/helpers.js";

/*
 * Row 011-268 (spec 011 C4 step 5 and C15 as amended 2026-10-29,
 * `research/named-wait-batches.md` Recommendation 4, done-when test 6):
 * with backlog queued, one tier of the files in no batch follows each
 * batch's tier, so a stream of waits moves the backlog by one tier after
 * each. `selectTier` on a `Ledger`, one lane, no pool; a tier holds at most
 * 4 files (`runner.backlogTierSize`), so the backlog of 28 lasts seven.
 */

const WT = "wt-011-268" as WorktreeId;
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

/** `runner`'s settings over the default's, `backlogTierSize` 4 unless set. */
function setup(runner: Partial<typeof DEFAULT_POLICY.runner> = {}) {
  const store = freshStore();
  stores.push(store);
  liveDaemon(store, WT);
  const at = { now: 1_000_000 };
  const context = {
    root: "/repo/wt-011-268",
    store,
    sink: createStateSink(store),
    worktreeId: WT,
    policy: {
      ...DEFAULT_POLICY,
      runner: { ...DEFAULT_POLICY.runner, backlogTierSize: 4, ...runner },
    },
    now: () => at.now,
    note: () => {},
    runsDir: "/repo/.git/squeal/runs",
    hostLoad: () => ({ oneMinute: null, cpus: 1 }),
    runner: {},
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

/** Queues `paths` as the backlog, or as an edit's work when `recent`, each at a key of its own. */
function queue(
  ledger: Ledger,
  paths: readonly string[],
  { recent = false, ms = null }: { recent?: boolean; ms?: number | null } = {},
): TestFileRef[] {
  return paths.map((path) => {
    const ref = { project: "", path };
    const file = ledger.addFile(ref);
    file.key = Buffer.from(path).toString("hex").padEnd(64, "0") as CheckKey;
    file.durationMs = ms;
    ledger.enqueue(file, recent ? Priority.edited : Priority.transitive, false, recent);
    return ref;
  });
}

/**
 * Selects tiers until none starts, each run ended between two selections as
 * the review's probe ended them: no file of a tier stays running, so a batch
 * ends with its tier. Each tier as its kind (`batch` for a batch's) and its
 * files' paths.
 */
function drain(context: SchedulerContext, ledger: Ledger) {
  const tiers: { kind: string; files: string[] }[] = [];
  for (let tier = selectTier(context, ledger, new Set(), NONE_CUT); tier !== null; ) {
    tiers.push({
      kind: tier.promoted === true ? "batch" : (tier.kind ?? "edit"),
      files: tier.files.map((f) => f.file.ref.path),
    });
    for (const { file } of tier.files) ledger.setRunning(file, null);
    ledger.commit();
    tier = selectTier(context, ledger, new Set(), NONE_CUT);
  }
  return tiers;
}

const paths = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `test/${prefix}${String(i).padStart(2, "0")}.test.ts`);

describe("a backlog tier follows each batch's tier (spec 011 C15, row 011-268)", () => {
  it("6. a stream of 7 four-file waits with backlog queued: a backlog tier follows each batch tier", () => {
    const { ledger, context, at } = setup();
    const backlog = queue(ledger, paths("b", 28));
    const waits = Array.from({ length: 7 }, (_, w) => queue(ledger, paths(`w${w}-`, 4)));
    for (const files of waits) ledger.queue.promote(files, at.now + 60_000);

    const tiers = Array.from({ length: 14 }, () => {
      const tier = selectTier(context, ledger, new Set(), NONE_CUT);
      return { batch: tier?.promoted === true, files: tier?.files.map((f) => f.file.ref) ?? [] };
    });
    // On main the seven batches ran first, then the backlog: a promoted-only tier never counted.
    expect(tiers.map((t) => t.batch)).toEqual(Array.from({ length: 14 }, (_, i) => i % 2 === 0));
    expect(tiers.filter((t) => t.batch).map((t) => t.files)).toEqual(waits);
    expect(tiers.filter((t) => !t.batch).flatMap((t) => t.files)).toEqual(backlog);
  });

  it("review 0.1.378 B1: with an edit's work queued too, the tier after the first batch's is the backlog's turn", () => {
    const { ledger, context, at } = setup({ tierSize: 1 });
    const [backlog] = queue(ledger, paths("b", 1), { ms: 1_000 });
    const edits = queue(ledger, paths("e", 10), { recent: true, ms: 1_000 });
    const waits = Array.from({ length: 5 }, (_, w) =>
      queue(ledger, paths(`w${w}-`, 1), { ms: 1_000 }),
    );
    for (const files of waits) ledger.queue.promote(files, at.now + 60_000);

    const tiers = drain(context, ledger);
    // Before the repair an edit took the turn after each batch, and the backlog ran after the
    // fifth: batch w0, edit e00, batch w1, edit e01, ..., batch w4, turn b00.
    expect(tiers.slice(0, 2)).toEqual([
      { kind: "batch", files: [waits[0]?.[0]?.path] },
      { kind: "turn", files: [backlog?.path] },
    ]);
    // With the backlog moved, the batches go first, then the edits' work.
    expect(tiers.slice(2).map((t) => t.kind)).toEqual([
      ...Array.from({ length: 4 }, () => "batch"),
      ...Array.from({ length: 10 }, () => "edit"),
    ]);
    expect(tiers.flatMap((t) => t.files).toSorted()).toEqual(
      [backlog, ...edits, ...waits.flat()].map((ref) => ref?.path).toSorted(),
    );
  });

  it("with no file outside a batch queued, batches follow one another", () => {
    const { ledger, context, at } = setup();
    const waits = Array.from({ length: 3 }, (_, w) => queue(ledger, paths(`w${w}-`, 4)));
    for (const files of waits) ledger.queue.promote(files, at.now + 60_000);

    const tiers = waits.map(() => selectTier(context, ledger, new Set(), NONE_CUT));
    expect(tiers.map((t) => t?.files.map((f) => f.file.ref))).toEqual(waits);
    expect(tiers.every((t) => t?.promoted === true && t.kind === "backlog")).toBe(true);
  });

  it("a re-wait of files already in a batch forms no batch, and the first keeps its place", () => {
    const { ledger, context, at } = setup();
    const first = queue(ledger, paths("a", 4));
    const second = queue(ledger, paths("c", 4));
    ledger.queue.promote(first, at.now + 1_000);
    ledger.queue.promote(second, at.now + 60_000);
    at.now += 2_000;
    // Past the first wait's deadline, its re-wait names the same files and one of the second's.
    ledger.queue.promote([...first, second[0] as TestFileRef], at.now + 60_000);

    const tier = selectTier(context, ledger, new Set(), NONE_CUT);
    expect(tier?.files.map((f) => f.file.ref)).toEqual(first);
    expect(selectTier(context, ledger, new Set(), NONE_CUT)?.files.map((f) => f.file.ref)).toEqual(
      second,
    );
  });
});
