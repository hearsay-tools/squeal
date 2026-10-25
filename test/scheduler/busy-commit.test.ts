import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { createStateSink } from "../../src/core/state/index.js";
import {
  isStoreOpenFailure,
  openStore,
  setBusyTimeout,
  storePaths,
} from "../../src/core/store/index.js";
import {
  type CheckError,
  type CheckKey,
  DEFAULT_POLICY,
  type ResultRecord,
  type RunOutcome,
  type SetupCheckId,
  type Store,
  type TestFileRef,
  type WorktreeId,
} from "../../src/core/types/index.js";

/*
 * Row 011-126: `Ledger.commit` drained what it owed (the key rows of dirty
 * files, results, unknowns, setup outcomes) before its `BEGIN IMMEDIATE`, so
 * a commit that gave up on a busy store lost them: files current in memory
 * stayed queued in `test_file_keys`, and their known states stale. It was so
 * at the daemon's 5 s busy timeout; the pump's writes now give up after a
 * 250 ms slice, so it would happen more often.
 */

const WORKTREE = "wt-126" as WorktreeId;
const KEY = "k".repeat(64) as CheckKey;
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function open(): { store: Store; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "sq-126-"));
  const store = openStore(dir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  cleanups.push(() => store.close());
  return { store, dir };
}

function ledgerOf(store: Store): Ledger {
  const context = {
    store,
    sink: createStateSink(store),
    worktreeId: WORKTREE,
    policy: DEFAULT_POLICY,
    now: Date.now,
    // No environment read: a setup check's runner is not known (spec 016 D3).
    keys: { runnerOf: () => undefined },
  } as unknown as SchedulerContext;
  return new Ledger(context);
}

/** Holds the store's write lock from a second connection until the returned release. */
function holdWriteLock(dir: string): () => void {
  const db = new DatabaseSync(storePaths(dir).database);
  db.exec("BEGIN IMMEDIATE");
  let held = true;
  const release = () => {
    if (!held) return;
    held = false;
    db.exec("COMMIT");
    db.close();
  };
  cleanups.push(release);
  return release;
}

const ref = (n: number): TestFileRef => ({ project: "", path: `test/f${n}.test.ts` });

function results(file: TestFileRef, outcome: RunOutcome): ResultRecord[] {
  return [
    {
      check: { kind: "test", project: file.project, testPath: file.path, fullName: "t0" },
      key: KEY,
      outcome,
      durationMs: 1,
      location: null,
      fingerprint: outcome === "fail" ? "fp-0" : null,
      summary: outcome === "fail" ? "boom" : null,
      errors: [],
      provenance: {
        worktreeId: WORKTREE,
        revision: 1,
        commit: null,
        dirty: false,
        runId: "run-126",
        recordedAt: 1_000,
      },
    },
  ] as ResultRecord[];
}

const SETUP: SetupCheckId = { kind: "setup", project: "", testPath: "test/setup.ts" };
const SETUP_ERROR: CheckError = {
  name: "Error",
  message: "setup threw",
  stack: null,
  location: null,
  diff: null,
} as CheckError;

describe("a ledger commit on a busy store (011-126)", () => {
  it("keeps what it drained, and the commit after the free writes each row once, a newer entry winning", () => {
    const { store, dir } = open();
    const ledger = ledgerOf(store);
    const a = ledger.addFile(ref(1));
    const b = ledger.addFile(ref(2));
    const c = ledger.addFile(ref(3));
    ledger.applyResults(c, KEY, results(ref(3), "pass"), null);
    ledger.commit();
    ledger.applyResults(a, KEY, results(ref(1), "fail"), null);
    ledger.markUnknown([{ file: c, key: KEY }], "not run: the run failed to start");
    ledger.setups.fail(SETUP, SETUP_ERROR, null);

    const release = holdWriteLock(dir);
    setBusyTimeout(store, 50);
    expect(() => ledger.commit()).toThrow(/database is locked/);
    // Newer than what the commit that gave up drained: b's results, and a's again, now passing.
    ledger.applyResults(b, KEY, results(ref(2), "pass"), null);
    ledger.applyResults(a, KEY, results(ref(1), "pass"), null);
    release();
    ledger.commit();

    const states = store.knownStates.list(WORKTREE);
    const outcome = (path: string) =>
      states.find(({ check }) => check.kind === "test" && check.testPath === path)?.outcome;
    expect(outcome("test/f1.test.ts")).toBe("pass");
    expect(outcome("test/f2.test.ts")).toBe("pass");
    expect(outcome("test/f3.test.ts")).toBe("unknown");
    expect(states.find(({ check }) => check.kind === "setup")?.outcome).toBe("fail");
    // a's fail, then its pass: each written once, in order.
    const history = store.transitions
      .history(WORKTREE, { kind: "test", project: "", testPath: "test/f1.test.ts", fullName: "t0" })
      .map((transition) => transition.kind);
    expect(history).toEqual(["first-seen-fail", "fail-to-pass"]);
    // The key rows match memory.
    const rows = store.testFileKeys.list(WORKTREE);
    expect(rows.map((row) => row.testFile.path).sort()).toEqual(
      [a, b, c].map((file) => file.ref.path),
    );
    for (const row of rows) {
      const file = ledger.file(row.testFile);
      expect(row.key).toBe(file?.key ?? null);
    }
  });

  it("writes what a commit before it drained once it is free, with nothing new owed", () => {
    const { store, dir } = open();
    const ledger = ledgerOf(store);
    const a = ledger.addFile(ref(1));
    ledger.applyResults(a, KEY, results(ref(1), "fail"), null);

    const release = holdWriteLock(dir);
    setBusyTimeout(store, 50);
    expect(() => ledger.commit()).toThrow(/database is locked/);
    release();
    ledger.commit();

    expect(store.testFileKeys.list(WORKTREE).map((row) => row.testFile.path)).toEqual([
      "test/f1.test.ts",
    ]);
    expect(store.knownStates.list(WORKTREE).map((state) => state.outcome)).toEqual(["fail"]);
  });
});
