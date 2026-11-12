import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { Keeper } from "../../../src/core/code/gate/keep.js";
import type { Hasher } from "../../../src/core/hash/hasher.js";
import { StatCache } from "../../../src/core/hash/stat-cache.js";
import { testFileId } from "../../../src/core/keys/reverse-index.js";
import type { WorktreeKeys } from "../../../src/core/scheduler/keying.js";
import { describeHolders, lockHolders } from "../../../src/core/store/lock-holders.js";
import { isStoreOpenFailure, openStore } from "../../../src/core/store/open.js";
import { storePaths } from "../../../src/core/store/paths.js";
import type { CheckKey, TestFileRef } from "../../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import type { RunReport } from "../../../src/core/types/runner.js";

/*
 * Spec 020 D17.3 (row 020-17c): what the keeper writes is the CLI cases'
 * (`test/cli/code-gate-keep*.test.ts`). Here: it never reaches the write
 * for a file that did not complete or has no record, and a failure while
 * keeping costs only the write, told once, and never fails the gate. D17.5
 * (row 020-28): a run only queues its files, and `flush` writes them. A
 * store whose write lock another connection holds is retried in busy
 * slices until a bound from the first busy write; the wait names the
 * holder, and a file still not written then is told as not kept.
 */

const REF: TestFileRef = { project: "", path: "test/a.test.ts" };
const KEY = "k".repeat(64) as CheckKey;
const RECORD = { v: 1, sources: [], unread: [] } as never;

/** Keys with no input to compare and nothing observed, as far as the keeper asks. */
const KEYS = {
  cache: new StatCache(),
  stabilityPaths: () => [],
  beginRun: () => 1,
  endRun: () => {},
  observes: () => false,
  environmentFiles: () => ["setup.ts"],
} as unknown as WorktreeKeys;

const HASHER: Hasher = { stat: async () => null, hash: async () => null, now: () => 0 };

function report(completed: readonly TestFileRef[]): RunReport {
  return {
    end: "completed",
    durationMs: 1,
    completedFiles: completed,
    results: [],
    fileErrors: [],
    failure: null,
  };
}

function keeper(head: () => Promise<never>, notes: string[]): Keeper {
  const keep = new Keeper({
    root: "/nowhere",
    commonDir: "/nowhere/.git",
    policy: DEFAULT_POLICY,
    head,
    note: (text) => notes.push(text),
  });
  keep.expect("vitest", KEYS, HASHER, new Map([[REF, KEY]]));
  return keep;
}

const run = (completed: readonly TestFileRef[], record: unknown) => ({
  runner: "vitest" as const,
  files: [REF],
  report: report(completed),
  records: new Map([[testFileId(REF), { record: record as never }]]),
});

describe("Keeper (spec 020 D17.3)", () => {
  it.each([
    ["did not complete", [], RECORD],
    ["has no record", [REF], null],
  ])("writes nothing of a file that %s", async (_, completed, record) => {
    const notes: string[] = [];
    const reached = () => Promise.reject(new Error("the write was reached"));

    const keep = keeper(reached, notes);
    await keep.ran(run(completed, record));
    await keep.flush();

    expect(notes).toEqual([]);
  });

  it("writes nothing until `flush` (D17.5)", async () => {
    const notes: string[] = [];
    const keep = keeper(() => Promise.reject(new Error("the write was reached")), notes);

    await keep.ran(run([REF], RECORD));
    expect(notes).toEqual([]);

    // The root does not exist, so the write fails at its first step.
    await keep.flush();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^1 completed test file was not kept in the stores: /);
  });

  it("tells a failure once and never throws it", async () => {
    const notes: string[] = [];
    const keep = keeper(() => Promise.reject(new Error("no head")), notes);

    await keep.ran(run([REF], RECORD));
    await expect(keep.flush()).resolves.toBeUndefined();
    keep.expect("vitest", KEYS, HASHER, new Map([[REF, KEY]]));
    await keep.ran(run([REF], RECORD));
    await keep.flush();

    // The root does not exist, so the write fails at its first step; it is told once.
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^1 completed test file was not kept in the stores: /);
  });

  it("writes nothing of a file whose run loaded an environment file its keys lack", async () => {
    const notes: string[] = [];
    const loaded = (paths: string[]) => ({
      ...run([REF], RECORD),
      report: { ...report([REF]), environmentObserved: [{ project: "", paths }] },
    });
    const reached = () => Promise.reject(new Error("the write was reached"));

    const lacking = keeper(reached, notes);
    await lacking.ran(loaded(["setup.ts", "other-setup.ts"]));
    await lacking.flush();
    expect(notes).toEqual([]);

    // One its keys hold does not stop it: the write is reached, and fails here.
    const holding = keeper(reached, notes);
    await holding.ran(loaded(["setup.ts"]));
    await holding.flush();
    expect(notes).toHaveLength(1);
  });

  it("keeps each lookup of one runner kind apart, and ends each run once (review 0.1.433 B2)", async () => {
    const runs = { begun: 0, inFlight: 0 };
    const keys = {
      ...KEYS,
      beginRun: () => {
        runs.inFlight += 1;
        runs.begun += 1;
        return runs.begun;
      },
      endRun: () => {
        runs.inFlight -= 1;
      },
    } as unknown as WorktreeKeys;
    // Each flush with files starts its write with the head, which fails here and counts the files.
    let writes = 0;
    const notes: string[] = [];
    const keep = new Keeper({
      // A root that exists, so the write reaches the head; nothing is written after it.
      root: tmpdir(),
      commonDir: "/nowhere/.git",
      policy: DEFAULT_POLICY,
      head: () => Promise.reject(new Error(`write ${++writes}`)),
      note: (text) => notes.push(text),
    });
    const ref = (project: string): TestFileRef => ({ project, path: "test/x.test.mjs" });
    const [a, b, c] = [ref("a"), ref("b"), ref("c")];
    const ranOf = (ref: TestFileRef) => ({
      runner: "node-test" as const,
      files: [ref],
      report: report([ref]),
      records: new Map([[testFileId(ref), { record: RECORD }]]),
    });
    for (const one of [a, b, c]) keep.expect("node-test", keys, HASHER, new Map([[one, KEY]]));
    keep.expect("node-test", keys, HASHER, new Map());
    expect(runs).toEqual({ begun: 3, inFlight: 3 });

    await keep.ran(ranOf(a));
    await keep.ran(ranOf(a));
    await keep.ran(ranOf(b));
    expect(runs.inFlight).toBe(1);
    await keep.flush();
    // `a` once and `b`: the second run of `a` found its lookup taken.
    expect(notes).toEqual(["2 completed test files were not kept in the stores: write 1"]);

    // `c`'s runner never ran: closing ends its run, and a late completion keeps nothing.
    keep.close();
    await keep.ran(ranOf(c));
    await keep.flush();
    expect([writes, runs.inFlight]).toEqual([1, 0]);
  });

  it("does nothing for a runner it was not told of", async () => {
    const notes: string[] = [];
    const keep = keeper(() => Promise.reject(new Error("the write was reached")), notes);

    await keep.ran({ ...run([REF], RECORD), runner: "node-test" });
    await keep.flush();

    expect(notes).toEqual([]);
  });
});

describe("Keeper on a store another connection holds (spec 020 D17.3, D17.5)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** A worktree root, a common directory with a store, and a connection holding its write lock. */
  function lockedStore() {
    const root = mkdtempSync(join(tmpdir(), "squeal-keep-"));
    dirs.push(root);
    const commonDir = join(root, ".git");
    mkdirSync(commonDir);
    const store = openStore(commonDir);
    if (isStoreOpenFailure(store)) throw new Error(store.reason);
    store.close();
    const holder = new DatabaseSync(storePaths(commonDir).database);
    holder.exec("BEGIN IMMEDIATE");
    const release = () => {
      if (!holder.isOpen) return;
      holder.exec("ROLLBACK");
      holder.close();
    };
    return {
      root,
      commonDir,
      release,
      holder: describeHolders(lockHolders(storePaths(commonDir).database)),
    };
  }

  async function kept(
    at: { root: string; commonDir: string },
    notes: string[],
    busyBoundMs: number,
  ): Promise<void> {
    const keep = new Keeper({
      root: at.root,
      commonDir: at.commonDir,
      policy: { ...DEFAULT_POLICY, complexity: { ...DEFAULT_POLICY.complexity, enabled: true } },
      head: async () => ({ head: "a".repeat(40), dirty: false }),
      note: (text) => notes.push(text),
      busyBoundMs,
    });
    keep.expect("vitest", KEYS, HASHER, new Map([[REF, KEY]]));
    await keep.ran(run([REF], RECORD));
    await keep.flush();
  }

  /** The results stored at `KEY`, read once the lock is free. */
  function resultsAt(commonDir: string): number {
    const db = new DatabaseSync(storePaths(commonDir).database, { readOnly: true });
    try {
      const row = db.prepare("SELECT count(*) AS n FROM results WHERE key = ?").get(KEY);
      return Number(row?.n);
    } finally {
      db.close();
    }
  }

  it("keeps the file once the lock is freed within the bound, and names the holder first", async () => {
    const locked = lockedStore();
    const notes: string[] = [];
    const freed = setTimeout(locked.release, 400);
    try {
      await kept(locked, notes, 5_000);
    } finally {
      clearTimeout(freed);
      locked.release();
    }
    expect(notes).toHaveLength(2);
    expect(notes[0]).toBe(
      `the store is busy (${locked.holder}); waiting up to 5 s to keep 1 completed test file: test/a.test.ts`,
    );
    expect(notes[1]).toMatch(/^the store was free after \d+(\.\d)? s: 1 completed test file kept$/);
    expect(resultsAt(locked.commonDir)).toBe(1);
  });

  it("keeps nothing while the lock outlasts the bound, and says who held it and what runs again", async () => {
    const locked = lockedStore();
    const notes: string[] = [];
    try {
      await kept(locked, notes, 600);
    } finally {
      locked.release();
    }
    expect(notes).toEqual([
      `the store is busy (${locked.holder}); waiting up to 0.6 s to keep 1 completed test file: test/a.test.ts`,
      `1 completed test file was not kept in the stores: the store stayed busy for 0.6 s (${locked.holder}); the next run will run it again`,
    ]);
    expect(resultsAt(locked.commonDir)).toBe(0);
  });
});
