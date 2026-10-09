import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { createStateSink } from "../../src/core/state/index.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import {
  type CheckKey,
  DEFAULT_POLICY,
  type ResultRecord,
  type RunOutcome,
  type Store,
  type TestFileRef,
  type WorktreeId,
} from "../../src/core/types/index.js";

/*
 * Task 001-161: a starting daemon exited on "database is locked" 5 s after
 * another worktree's daemon began recording a 250-file tier. `Ledger.commit`
 * called the sink once per file, and each call listed every known state of
 * the worktree inside the write transaction: 6 s with 4,982 states, 30 s with
 * 15,468, on a copy of cezar's store at load 2 per CPU.
 */

const WORKTREE = "wt-161" as WorktreeId;
const KEY = "k".repeat(64) as CheckKey;
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function open(): Store {
  const dir = mkdtempSync(join(tmpdir(), "sq-161-"));
  const store = openStore(dir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  cleanups.push(() => store.close());
  return store;
}

function ledgerOf(store: Store): Ledger {
  const context = {
    store,
    sink: createStateSink(store),
    worktreeId: WORKTREE,
    policy: DEFAULT_POLICY,
    now: Date.now,
  } as unknown as SchedulerContext;
  return new Ledger(context);
}

const ref = (n: number): TestFileRef => ({ project: "", path: `test/f${n}.test.ts` });

function results(file: TestFileRef, tests: number, outcome: RunOutcome = "pass"): ResultRecord[] {
  return Array.from({ length: tests }, (_, i) => ({
    check: { kind: "test", project: file.project, testPath: file.path, fullName: `t${i}` },
    key: KEY,
    outcome,
    durationMs: 1,
    location: null,
    fingerprint: outcome === "fail" ? `fp-${i}` : null,
    summary: outcome === "fail" ? "boom" : null,
    errors: [],
    provenance: {
      worktreeId: WORKTREE,
      revision: 1,
      commit: null,
      dirty: false,
      runId: "run-161",
      recordedAt: 1_000,
    },
  })) as ResultRecord[];
}

/** Counts `knownStates.list` calls per outermost write transaction. */
function countLists(store: Store): number[] {
  const perTransaction: number[] = [];
  const list = store.knownStates.list;
  const transaction = store.transaction;
  let depth = 0;
  store.knownStates.list = (id) => {
    if (depth > 0) perTransaction[perTransaction.length - 1] = (perTransaction.at(-1) ?? 0) + 1;
    return list(id);
  };
  store.transaction = (fn) => {
    if (depth === 0) perTransaction.push(0);
    depth++;
    try {
      return transaction(fn);
    } finally {
      depth--;
    }
  };
  return perTransaction;
}

describe("Ledger.commit writes a tier in one short transaction (task 001-161)", () => {
  it("lists the worktree's known states once per sink call for a tier of one checkpoint, not once per file", () => {
    const store = open();
    const ledger = ledgerOf(store);
    const lists = countLists(store);
    for (let n = 0; n < 25; n++) {
      const file = ledger.addFile(ref(n));
      ledger.applyResults(file, KEY, results(ref(n), 4), "checkpoint-1");
    }
    ledger.commit();

    // One `applyResults` and the `refresh` of the files' new key rows; per file it was 26.
    expect(lists).toEqual([2]);
    expect(store.knownStates.list(WORKTREE)).toHaveLength(100);
  });

  it("starts a new sink call per checkpoint and when a check repeats, as separate calls would", () => {
    const store = open();
    const ledger = ledgerOf(store);
    const lists = countLists(store);
    const a = ledger.addFile(ref(1));
    const b = ledger.addFile(ref(2));
    ledger.applyResults(a, KEY, results(ref(1), 1, "fail"), "checkpoint-1");
    ledger.applyResults(b, KEY, results(ref(2), 1, "fail"), "checkpoint-1");
    // The same check again in one commit: fail, then pass.
    ledger.applyResults(a, KEY, results(ref(1), 1, "pass"), "checkpoint-1");
    ledger.applyResults(b, KEY, results(ref(2), 1, "pass"), "checkpoint-2");
    ledger.commit();

    // Three `applyResults` (checkpoint 1 until f1 repeats, then f1, then checkpoint 2) and one `refresh`.
    expect(lists).toEqual([4]);
    const kinds = (file: TestFileRef) =>
      store.transitions
        .history(WORKTREE, { kind: "test", project: "", testPath: file.path, fullName: "t0" })
        .map((t) => t.kind);
    // In one call both would be read against no prior state: the recovery would be lost.
    expect(kinds(ref(1))).toEqual(["first-seen-fail", "fail-to-pass"]);
    expect(kinds(ref(2))).toEqual(["first-seen-fail", "fail-to-pass"]);
  });

  it("holds the write lock well under the daemon's 5 s busy timeout for 5,000 results beside 15,000 states", () => {
    const store = open();
    const sink = createStateSink(store);
    // The rest of a worktree the size of cezar's main one.
    const others = Array.from({ length: 600 }, (_, n) => results(ref(1_000 + n), 25)).flat();
    sink.applyResults(WORKTREE, 1, others, { checkpointId: null });

    const ledger = ledgerOf(store);
    const tier = Array.from({ length: 250 }, (_, n) => ({
      file: ref(n),
      records: results(ref(n), 20),
    }));
    store.results.putMany(tier.flatMap((t) => t.records));
    for (const { file, records } of tier) {
      ledger.applyResults(ledger.addFile(file), KEY, records, "checkpoint-1");
    }
    const lists = countLists(store);
    const started = performance.now();
    ledger.commit();
    const heldMs = performance.now() - started;

    expect(lists).toEqual([2]);
    expect(store.knownStates.list(WORKTREE)).toHaveLength(20_000);
    // Per file this was 250 lists of 15,000 states: about 30 s at load 2 per CPU.
    expect(heldMs).toBeLessThan(5_000);
  }, 120_000);
});
