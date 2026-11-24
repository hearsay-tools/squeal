import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { type Drained, Ledger, sliceDrained } from "../../src/core/scheduler/ledger.js";
import { covers, readRefined, recordRefinedApplied } from "../../src/core/scheduler/refined.js";
import { createStateSink } from "../../src/core/state/sink.js";
import { observeWrites } from "../../src/core/store/connection.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import type { WorktreeId } from "../../src/core/types/common.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import type { Store } from "../../src/core/types/store.js";
import type { ResultRecord } from "../../src/core/types/store-records.js";

/*
 * Row 025-10 (spec 025 D10, item 1): a start's commit of every listed file
 * goes in write transactions of at most `WRITE_SLICE_FILES` files, and no
 * reader takes a half-written commit for a settled worktree: until the last
 * slice records the refined revision, the runner part reads as pending.
 */

const WORKTREE = "wt-sliced" as WorktreeId;
const KEY = "k".repeat(64) as CheckKey;
const REVISION = 4;
const cleanups: (() => void)[] = [];

afterEach(() => {
  observeWrites(null);
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function open(): Store {
  const dir = mkdtempSync(join(tmpdir(), "sq-sliced-"));
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
    keys: { runnerOf: () => undefined, writeRuntimeApplications: () => {} },
  } as unknown as SchedulerContext;
  const ledger = new Ledger(context);
  ledger.revision = { number: REVISION, head: null, dirty: false };
  return ledger;
}

const ref = (n: number): TestFileRef => ({ project: "", path: `test/f${n}.test.ts` });

function results(file: TestFileRef, checks = 2): ResultRecord[] {
  return Array.from({ length: checks }, (_, i) => ({
    check: { kind: "test", project: file.project, testPath: file.path, fullName: `t${i}` },
    key: KEY,
    outcome: "pass",
    durationMs: 1,
    location: null,
    fingerprint: null,
    summary: null,
    errors: [],
    provenance: {
      worktreeId: WORKTREE,
      revision: REVISION,
      commit: null,
      dirty: false,
      runId: "run-sliced",
      recordedAt: 1_000,
    },
  })) as ResultRecord[];
}

/** A ledger with `n` files, each with its results applied: a start's lookup hits. */
function started(store: Store, n: number): Ledger {
  const ledger = ledgerOf(store);
  for (let i = 0; i < n; i++) {
    const file = ledger.addFile(ref(i));
    ledger.applyResults(file, KEY, results(ref(i)), null);
  }
  return ledger;
}

/** What a reader sees: key rows, known states, and whether the runner part is pending. */
function seen(store: Store) {
  return {
    rows: store.testFileKeys.list(WORKTREE).length,
    states: store.knownStates.list(WORKTREE).length,
    pending: !covers(readRefined(store, WORKTREE), REVISION),
  };
}

const NONE: Drained = {
  dirty: [],
  removed: [],
  rekeyed: [],
  applied: [],
  unknown: [],
  unknownFiles: [],
  retired: [],
  setups: [],
};

describe("a start's commit in slices (row 025-10)", () => {
  it("splits free files into parts of at most the slice, their results with them", () => {
    const ids = Array.from({ length: 9 }, (_, i) => testFileId(ref(i)));
    const parts = sliceDrained(
      {
        ...NONE,
        dirty: ids,
        applied: [
          {
            results: [0, 1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => results(ref(i), 1)),
            checkpointId: "c",
          },
        ],
        unknown: [{ testFiles: [ref(1)], reason: "why", runId: null }],
        rekeyed: [[ids[0] as string, null]],
      },
      3,
    );
    // f1 is named by an unknown mark, so it goes last; f0's re-key mark goes last, its row ahead.
    expect(parts.map((part) => part.dirty)).toEqual([
      [ids[0], ids[2], ids[3]],
      [ids[4], ids[5], ids[6]],
      [ids[1], ids[7], ids[8]],
    ]);
    expect(
      parts.map((part) =>
        part.applied.flatMap((a) =>
          a.results.map((r) => (r.check.kind === "setup" ? "" : r.check.testPath)),
        ),
      ),
    ).toEqual([
      ["test/f0.test.ts", "test/f2.test.ts", "test/f3.test.ts"],
      ["test/f4.test.ts", "test/f5.test.ts", "test/f6.test.ts"],
      ["test/f1.test.ts", "test/f7.test.ts", "test/f8.test.ts"],
    ]);
    expect(
      parts.slice(0, 2).every((part) => part.unknown.length === 0 && part.rekeyed.length === 0),
    ).toBe(true);
    expect(parts[2]?.unknown).toHaveLength(1);
    expect(parts[2]?.rekeyed).toHaveLength(1);
    expect(sliceDrained({ ...NONE, dirty: ids.slice(0, 3) }, 3)).toHaveLength(1);
  });

  it("writes at most the slice per transaction, and readers see the runner part pending until the last", async () => {
    const store = open();
    const ledger = started(store, 450);
    const before: ReturnType<typeof seen>[] = [];
    await ledger.commitInSlices(
      { refined: REVISION },
      async (write) => {
        before.push(seen(store));
        write();
      },
      200,
    );
    const after = seen(store);
    expect(before.map((s) => s.rows)).toEqual([0, 200, 400]);
    expect(before.map((s) => s.states)).toEqual([0, 400, 800]);
    // Between slices the commit is half-written, and every reader is told so.
    expect(before.slice(1).every((s) => s.pending)).toBe(true);
    expect(after).toEqual({ rows: 450, states: 900, pending: false });
    expect(readRefined(store, WORKTREE)).toBe(REVISION);
  });

  it("holds back a refined revision an earlier daemon recorded, and records it again at the end", async () => {
    const store = open();
    store.transaction(() => recordRefinedApplied(store, WORKTREE, REVISION));
    const ledger = started(store, 450);
    const pending: boolean[] = [];
    await ledger.commitInSlices(
      { refined: REVISION },
      async (write) => {
        write();
        pending.push(seen(store).pending);
      },
      200,
    );
    expect(pending).toEqual([true, true, false]);
  });

  it("writes a small commit, or one with no refined revision, in one transaction", async () => {
    const store = open();
    let transactions = 0;
    observeWrites(() => {
      transactions++;
      return null;
    });
    await started(store, 150).commitInSlices({ refined: REVISION }, undefined, 200);
    expect(transactions).toBe(1);
    transactions = 0;
    const other = open();
    await started(other, 450).commitInSlices({}, undefined, 200);
    expect(transactions).toBe(1);
    expect(readRefined(other, WORKTREE)).toBeNull();
  });

  it("owes again what no slice wrote when a busy store's refusal is given up on", async () => {
    const store = open();
    const ledger = started(store, 450);
    let tries = 0;
    const busy = Object.assign(new Error("database is locked"), { errcode: 5 });
    await expect(
      ledger.commitInSlices(
        { refined: REVISION },
        async (write) => {
          if (++tries === 2) throw busy;
          write();
        },
        200,
      ),
    ).rejects.toBe(busy);
    expect(seen(store)).toEqual({ rows: 200, states: 400, pending: true });
    ledger.commit({ refined: REVISION });
    expect(seen(store)).toEqual({ rows: 450, states: 900, pending: false });
  });
});
