import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createDaemonLoop } from "../../src/core/daemon-loop/index.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { STORED_KEYS_OVERLAP_MS } from "../../src/core/scheduler/stored-keys.js";
import { formatWhy, readWhy } from "../../src/core/status/index.js";
import { setBusyTimeout, storePaths } from "../../src/core/store/index.js";
import {
  type CheckKey,
  DEFAULT_POLICY,
  type EpochMs,
  type KnownState,
  type Store,
} from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { claimRepo, FakeRunner, fileName, type Side, side } from "./claims-fixture.js";
import { RecordingSink } from "./recording-sink.js";

/*
 * Spec 011 C4 step 3 as amended 2026-10-20 (task 011-23, `research/catch-up.md`
 * done-when 1 to 4): a file whose key has no result here adopts the results
 * another worktree stores at its key, on the next reconciliation pass or tier
 * selection, with no run here. On cezar a second worktree on the main
 * checkout's commit stayed at 747 stale files under `lookup-only` while the
 * main checkout's `run --all` stored passes at the same keys.
 */

const COUNT = 6;
const all = Array.from({ length: COUNT }, (_, i) => fileName(i));
const F0 = fileName(0);
const LOOKUP_ONLY = { baseline: { onStart: "lookup-only" as const } };
/** Real schedulers, a real store and git: a loaded host needs headroom. */
const SLOW = { timeout: 60_000 } as const;

/** The current test states of `s`. */
function current(s: Side): KnownState[] {
  return s.store.knownStates
    .list(s.worktreeId)
    .filter((state) => state.check.kind === "test" && state.validity === "current");
}

/** A reconciliation pass that found no change, as the change feed's every 30 s. */
const pass = (s: Side) => s.scheduler.handleBatch({ trigger: "interval", paths: [] });

/** Two worktrees on one commit under `lookup-only`: neither has run a file. */
async function twoWorktrees() {
  const { main, other } = claimRepo(COUNT);
  const a = side(main, { count: COUNT, policy: LOOKUP_ONLY, rerunCap: 0 });
  const b = side(other, { count: COUNT, policy: LOOKUP_ONLY });
  await Promise.all([a.scheduler.start(), b.scheduler.start()]);
  await Promise.all([a.scheduler.idle(), b.scheduler.idle()]);
  expect(current(a)).toEqual([]);
  expect(current(b)).toEqual([]);
  for (const path of all) expect(b.keyOf(path)).toBe(a.keyOf(path));
  return { a, b };
}

describe("a stale file adopts a result another worktree stored at its key (011-23)", SLOW, () => {
  it("1. after the first's run --all, the second's files are current within one pass, inherited, with no run", async () => {
    const { a, b } = await twoWorktrees();
    await a.scheduler.requestFullSuite();
    await a.scheduler.idle();
    expect(a.passing()).toBe(COUNT);

    await pass(b);
    await b.scheduler.idle();
    expect(b.runner.runs).toEqual([]);
    expect(b.passing()).toBe(COUNT);
    const head = git(a.root, ["rev-parse", "HEAD"]).trim();
    for (const state of current(b)) {
      expect(state.origin).toEqual({ kind: "inherited", worktreeId: a.worktreeId, commit: head });
    }
    for (const path of all) expect(b.phase(path)).toBeNull();
  });

  it("1. through the daemon loop: its own reconciliation timer's pass adopts", async () => {
    const { main, other } = claimRepo(COUNT);
    const a = side(main, { count: COUNT, policy: LOOKUP_ONLY });
    await a.scheduler.start();
    await a.scheduler.idle();
    const store = a.store;
    const worktreeId = worktreeIdFor(other);
    const runner = new FakeRunner(all.map((path) => ({ project: "", path })));
    const errors: Error[] = [];
    const loop = createDaemonLoop({
      root: other,
      worktreeId,
      store,
      runner,
      sink: new RecordingSink(store, worktreeId),
      policy: { ...DEFAULT_POLICY, ...LOOKUP_ONLY },
      squealVersion: "0.0.0-test",
      runsDir: storePaths(join(main, ".git")).runsDir,
      onError: (error) => errors.push(error),
      timings: { reconcileIntervalMs: 200 },
    });
    try {
      await loop.start();
      await loop.scheduler.idle();
      const passing = () =>
        store.knownStates
          .list(worktreeId)
          .filter(
            (s) => s.check.kind === "test" && s.outcome === "pass" && s.validity === "current",
          ).length;
      expect(passing()).toBe(0);

      await a.scheduler.requestFullSuite();
      await a.scheduler.idle();
      await expect.poll(passing, { timeout: 10_000 }).toBe(COUNT);
      expect(runner.runs).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await loop.close();
    }
  });

  it("2. a fail the first stored stays held in the second: no known failure, being confirmed, nothing queued", async () => {
    const { a, b } = await twoWorktrees();
    a.runner.failing.add(F0);
    await a.scheduler.requestFullSuite();
    await a.scheduler.idle();

    await pass(b);
    await b.scheduler.idle();
    expect(b.runner.runs).toEqual([]);
    expect(b.passing()).toBe(COUNT - 1);
    expect(current(b).map((state) => state.check.testPath)).not.toContain(F0);
    expect(b.store.knownStates.list(b.worktreeId).filter((s) => s.outcome === "fail")).toEqual([]);
    expect(b.phase(F0)).toBeNull();
    const why = readWhy(b.root, `${F0} > passes`);
    expect(why).toMatchObject({
      found: true,
      knownState: null,
      heldFailure: { outcome: "fail", provenance: { worktreeId: a.worktreeId } },
    });
    expect(formatWhy(why)).toContain("being confirmed");

    // Passes later find it held still, and queue nothing.
    await pass(b);
    await b.scheduler.idle();
    expect(b.runner.runs).toEqual([]);
    expect(b.phase(F0)).toBeNull();
  });

  it("2. under lookup-then-run-missing a held fail stays queued and runs; the passes are taken at once", async () => {
    const { main, other } = claimRepo(COUNT);
    const last = fileName(COUNT - 1);
    const a = side(main, { count: COUNT, policy: LOOKUP_ONLY, rerunCap: 0 });
    await a.scheduler.start();
    await a.scheduler.idle();
    // b runs one file at a time and holds its first, edited here so no claim joins a's run to it:
    // the other five wait queued.
    appendFileSync(join(other, F0), "// b's edit\n");
    const b = side(other, { count: COUNT, tierSize: 1, backlogTierSize: 1, policy: RUN_MISSING });
    b.runner.hold();
    await b.scheduler.start();
    await expect.poll(() => b.phase(F0)).toBe("running");
    for (const path of all.slice(1)) expect(b.phase(path)).toBe("queued");

    a.runner.failing.add(last);
    await a.scheduler.requestFullSuite();
    await a.scheduler.idle();
    await pass(b);
    // While b's first tier still runs: the passes are current, the held fail queued.
    expect(b.runner.runs.flat().map((f) => f.path)).toEqual([F0]);
    for (const path of all.slice(1, -1)) expect(b.phase(path)).toBeNull();
    expect(b.phase(last)).toBe("queued");

    b.runner.release();
    await b.scheduler.idle();
    expect(b.runner.ran(last)).toBe(1);
    expect(b.runner.runs.flat().map((f) => f.path)).toEqual([F0, last]);
  });

  it("3. a pass with nothing new takes no write lock, nor does a key no file here holds", async () => {
    const { a, b } = await twoWorktrees();
    a.runner.failing.add(F0);
    await a.scheduler.requestFullSuite();
    await a.scheduler.idle();
    await pass(b);
    await b.scheduler.idle();
    expect(b.passing()).toBe(COUNT - 1);

    // a stores at a key b has no file at: an edit of its own.
    appendFileSync(join(a.root, fileName(1)), "// a's edit\n");
    await a.batch(fileName(1));
    await a.scheduler.requestFullSuite();
    await a.scheduler.idle();
    expect(a.keyOf(fileName(1))).not.toBe(b.keyOf(fileName(1)));

    setBusyTimeout(b.store, 50);
    const release = holdWriteLock(a.root);
    try {
      // Within the overlap: the keys read before, the held fail's among them, and a's new one.
      await pass(b);
      await b.scheduler.idle();
    } finally {
      release();
    }
    expect(b.runner.runs).toEqual([]);
    expect(b.passing()).toBe(COUNT - 1);
  });

  it("4. a result recorded before the last read but committed after it is adopted", async () => {
    const { a, b } = await twoWorktrees();
    const before = Date.now();
    await pass(b);
    await b.scheduler.idle();
    const key = b.keyOf(F0) ?? null;
    expect(key).not.toBeNull();

    // Its transaction took its time before b's read and committed after it.
    storedAt(a.store, a.worktreeId, F0, key as CheckKey, before - STORED_KEYS_OVERLAP_MS / 2);
    await pass(b);
    await b.scheduler.idle();
    expect(b.runner.runs).toEqual([]);
    expect(current(b).map((state) => state.check.testPath)).toEqual([F0]);
  });

  it.each([
    ["the lookup's write", "lookup"],
    ["the commit", "commit"],
  ])("5. a pass a busy store stopped at %s adopts on the next (001-422)", async (_, at) => {
    const { a, b } = await twoWorktrees();
    await a.scheduler.requestFullSuite();
    await a.scheduler.idle();

    if (at === "lookup") {
      setBusyTimeout(b.store, 50);
      const release = holdWriteLock(a.root);
      try {
        await expect(pass(b)).rejects.toThrow(/locked/);
      } finally {
        release();
      }
    } else {
      const transaction = b.store.transaction.bind(b.store);
      b.store.transaction = (<T>(fn: () => T): T => {
        if (new Error().stack?.includes("stored-keys")) {
          throw Object.assign(new Error("database is locked"), { errcode: 5 });
        }
        return transaction(fn);
      }) as Store["transaction"];
      try {
        await expect(pass(b)).rejects.toThrow(/locked/);
      } finally {
        b.store.transaction = transaction;
      }
    }
    expect(b.passing()).toBe(0);

    await pass(b);
    await b.scheduler.idle();
    expect(b.runner.runs).toEqual([]);
    expect(b.passing()).toBe(COUNT);
  });
});

/** Holds the store's write lock from a second connection until the returned release. */
function holdWriteLock(root: string): () => void {
  const db = new DatabaseSync(storePaths(join(root, "..", "main", ".git")).database);
  db.exec("BEGIN IMMEDIATE");
  return () => {
    db.exec("COMMIT");
    db.close();
  };
}

/** `worktreeId`'s passing result of `path` at `key`, recorded at `at`, written now. */
function storedAt(store: Store, worktreeId: string, path: string, key: CheckKey, at: EpochMs) {
  store.results.putMany([
    {
      check: { kind: "test", project: "", testPath: path, fullName: "passes" },
      key,
      outcome: "pass",
      durationMs: 1,
      location: null,
      fingerprint: null,
      summary: null,
      errors: [],
      provenance: {
        worktreeId,
        revision: 1,
        commit: "0".repeat(40),
        dirty: false,
        runId: randomUUID(),
        recordedAt: at,
      },
    },
  ]);
}
