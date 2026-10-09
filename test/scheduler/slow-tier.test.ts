import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { readTurn } from "../../src/core/delivery/turn.js";
import { testFileId } from "../../src/core/keys/index.js";
import { readDaemonNotes } from "../../src/core/notes.js";
import { readSlowActivity } from "../../src/core/slow/state.js";
import {
  DEFAULT_POLICY,
  type Policy,
  type PolicyInputs,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { waitFor } from "../watcher/helpers.js";
import {
  addWorktree,
  createRepo,
  type Harness,
  type HarnessOptions,
  openHarness,
  openRepoStore,
  ref,
  SLOW,
} from "./helpers.js";

/*
 * Spec 004 D2 to D6 with the scheduler over real Vitest runs: slow files form
 * their own tier class, run one at a time behind fast work and only on a
 * trigger, under the per-user slot and the load guard, are discarded when a
 * keyed input moved during their run, and are inherited only with a declared
 * artifact. In the `basic` fixture `test/strings.test.ts` and
 * `test/upper.test.ts` import `src/strings.ts`; the others are fast.
 */

const STRINGS = "test/strings.test.ts";
const UPPER = "test/upper.test.ts";
const SLOW_FILES = [STRINGS, UPPER];

const slotDirs: string[] = [];
afterEach(() => {
  for (const dir of slotDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function slotDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "squeal-004-12-slot-"));
  slotDirs.push(dir);
  return dir;
}

function slowPolicy(include: readonly string[], inputs: PolicyInputs = []): Partial<Policy> {
  return { slow: { ...DEFAULT_POLICY.slow, include }, inputs };
}

function options(extra: Partial<HarnessOptions> & { inputs?: PolicyInputs } = {}): HarnessOptions {
  const { inputs, ...rest } = extra;
  return {
    tierSize: 4,
    policy: slowPolicy(SLOW_FILES, inputs),
    slow: { slotDir: slotDir(), recheckMs: 50, load: () => [0], cpus: () => 1 },
    ...rest,
  };
}

const paths = (h: Harness) => h.runner.runs.map((run) => run.files.map((f) => f.path));
const isSlowRun = (files: readonly string[]) => files.some((f) => SLOW_FILES.includes(f));
const slowRuns = (h: Harness) => paths(h).filter(isSlowRun);

describe("the slow tier (spec 004 D2)", SLOW, () => {
  it("never puts a slow file in a fast tier and runs each alone once fast work is done", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, options());
    await h.scheduler.start();
    await h.scheduler.idle();
    let runs = paths(h);
    expect(runs.filter(isSlowRun)).toEqual(expect.arrayContaining([[STRINGS], [UPPER]]));
    const lastFast = runs.findLastIndex((files) => !isSlowRun(files));
    const firstSlow = runs.findIndex(isSlowRun);
    expect(firstSlow).toBeGreaterThan(lastFast);

    // An edit reaching a fast and two slow files: the fast one runs first, the slow ones alone.
    const before = h.runner.runs.length;
    h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase(); // edited\n");
    h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // edited\n");
    await h.batch("src/strings.ts", "src/math.ts");
    await h.scheduler.idle();
    runs = paths(h).slice(before);
    expect(runs[0]).toEqual(["test/math.test.ts"]);
    expect(runs.slice(1).sort()).toEqual([[STRINGS], [UPPER]]);
  });

  it("waits while a consumer is in a turn, is recorded pending by Stop, and runs once it is idle", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, options());
    const { delivery, consumer } = await h.consumer();
    await delivery.startTurn(consumer);
    await h.scheduler.start();
    await h.scheduler.idle();
    await delay(300);
    expect(slowRuns(h)).toEqual([]);
    expect(h.runsOf("test/math.test.ts")).toHaveLength(1);
    const pending = store.testFileKeys
      .list(h.worktreeId)
      .filter((row) => row.pending !== null)
      .map((row) => row.testFile.path);
    expect(pending.sort()).toEqual(SLOW_FILES);

    // D9: a silent Stop records the slow files pending like any pending file.
    await delivery.endTurn(consumer);
    const turn = readTurn(store, consumer);
    expect(turn.turn === "idle" ? turn.testFiles : []).toEqual(
      SLOW_FILES.map((p) => testFileId(ref(p))),
    );
    await waitFor(() => slowRuns(h).length === 2, 30_000);
  });

  it("runs on requestSlowSuite while a consumer is in a turn", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, options());
    const { delivery, consumer } = await h.consumer();
    await delivery.startTurn(consumer);
    await h.scheduler.start();
    await h.scheduler.idle();
    expect(slowRuns(h)).toEqual([]);
    const request = await h.scheduler.requestSlowSuite();
    expect(request).toEqual({ revision: h.scheduler.status().revision, queued: 2 });
    await waitFor(() => slowRuns(h).length === 2, 30_000);
    await h.scheduler.idle();
    // Every slow file is current now: a second request queues nothing.
    expect(await h.scheduler.requestSlowSuite()).toMatchObject({ queued: 0 });
  });

  it("lets an edit's fast file run between two slow files", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, options());
    let edit: Promise<void> | null = null;
    h.runner.beforeRun = (files) => {
      if (edit !== null || !isSlowRun(files.map((f) => f.path))) return;
      // Not awaited: the agent edits while the first slow file runs.
      edit = (async () => {
        h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // edited\n");
        await h.batch("src/math.ts");
      })();
    };
    await h.scheduler.start();
    await waitFor(() => slowRuns(h).length === 2, 60_000);
    await edit;
    await h.scheduler.idle();
    const runs = paths(h);
    const first = runs.findIndex(isSlowRun);
    expect(runs.slice(first)).toEqual([
      runs[first],
      ["test/math.test.ts"],
      expect.arrayContaining([expect.stringMatching(/strings|upper/)]),
    ]);
  });

  it("gives way to an edit while the load guard waits, then runs when the load drops", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    let load = 8;
    const h = await openHarness(
      repo.main,
      store,
      repo.commonDir,
      options({ slow: { slotDir: slotDir(), recheckMs: 50, load: () => [load], cpus: () => 1 } }),
    );
    await h.scheduler.start();
    await waitFor(() => h.runsOf("test/math.test.ts").length === 1, 60_000);
    await delay(200);
    h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // edited\n");
    await h.batch("src/math.ts");
    await waitFor(() => h.runsOf("test/math.test.ts").length === 2, 60_000);
    await delay(200);
    expect(slowRuns(h)).toEqual([]);
    load = 0.5;
    await waitFor(() => slowRuns(h).length === 2, 60_000);
    await h.scheduler.idle();
    expect(
      readDaemonNotes(store, h.worktreeId).some((n) => n.text.includes("ran under load")),
    ).toBe(false);
  });

  it("runs under load with a note once slow.maxDeferMs is spent", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      ...options({ slow: { slotDir: slotDir(), recheckMs: 50, load: () => [3], cpus: () => 1 } }),
      policy: { slow: { ...DEFAULT_POLICY.slow, include: SLOW_FILES, maxDeferMs: 300 } },
    });
    await h.scheduler.start();
    await waitFor(() => slowRuns(h).length === 2, 60_000);
    await h.scheduler.idle();
    const notes = readDaemonNotes(store, h.worktreeId).filter((n) =>
      n.text.includes("ran under load"),
    );
    expect(notes.map((n) => n.text)).toEqual([
      expect.stringContaining("ran under load 3.00 per CPU"),
      expect.stringContaining("ran under load 3.00 per CPU"),
    ]);
  });
});

describe("the slow slot shared by two worktrees (spec 004 D2)", SLOW, () => {
  it("runs one slow file at a time across both schedulers", async () => {
    const repo = createRepo();
    const other = addWorktree(repo.main, repo.dir, "other");
    const store = openRepoStore(repo.commonDir);
    const shared = slotDir();
    const slow = { slotDir: shared, recheckMs: 50, load: () => [0], cpus: () => 1 };
    const a = await openHarness(repo.main, store, repo.commonDir, options({ slow }));
    const b = await openHarness(other, store, repo.commonDir, options({ slow }));
    let active = 0;
    let most = 0;
    for (const h of [a, b]) {
      const run = h.runner.run.bind(h.runner);
      h.runner.run = async (files, runOptions) => {
        const slowRun = isSlowRun(files.map((f) => f.path));
        if (slowRun) most = Math.max(most, ++active);
        try {
          // Wide enough for an overlap to show.
          if (slowRun) await delay(400);
          return await run(files, runOptions);
        } finally {
          if (slowRun) active--;
        }
      };
    }
    await Promise.all([a.scheduler.start(), b.scheduler.start()]);
    await waitFor(() => slowRuns(a).length === 2 && slowRuns(b).length === 2, 90_000);
    expect(most).toBe(1);
  });

  /*
   * Lessons defect 2: the holder kept the slot across its load guard's wait
   * and re-took it at once after each file, so the other worktree waited for
   * its whole tier. Three slow files each; `starts` is the order slow runs began.
   */
  async function pair(aLoad: () => number) {
    const repo = createRepo();
    const other = addWorktree(repo.main, repo.dir, "other");
    const store = openRepoStore(repo.commonDir);
    const shared = slotDir();
    const policy = slowPolicy([...SLOW_FILES, "test/plain.test.ts"]);
    const slow = (load: () => number) => ({
      slotDir: shared,
      recheckMs: 50,
      load: () => [load()],
      cpus: () => 1,
    });
    const a = await openHarness(
      repo.main,
      store,
      repo.commonDir,
      options({ policy, slow: slow(aLoad) }),
    );
    const b = await openHarness(
      other,
      store,
      repo.commonDir,
      options({ policy, slow: slow(() => 0) }),
    );
    const starts: string[] = [];
    const isSlow = (files: readonly TestFileRef[]) =>
      files.some((f) => policy.slow?.include.includes(f.path));
    for (const [name, h] of [
      ["a", a],
      ["b", b],
    ] as const) {
      h.runner.beforeRun = (files) => {
        if (isSlow(files)) starts.push(name);
      };
    }
    const done = () => starts.filter((s) => s === "a").length >= 3 && starts.length >= 6;
    return { store, a, b, starts, isSlow, done };
  }

  it("lets the other worktree run while the holder's load guard waits", async () => {
    let load = 0;
    const { a, b, starts, isSlow, done } = await pair(() => load);
    const record = a.runner.beforeRun;
    a.runner.beforeRun = (files) => {
      record?.(files);
      // After its first slow file, the guard holds the next one.
      if (isSlow(files) && starts.filter((s) => s === "a").length === 1) load = 8;
    };
    await a.scheduler.start();
    await waitFor(() => starts.includes("a"), 60_000);
    await b.scheduler.start();
    const deadline = Date.now() + 20_000;
    while (!starts.includes("b") && Date.now() < deadline) await delay(50);
    load = 0;
    await waitFor(done, 90_000);
    expect(starts.indexOf("b")).toBeLessThan(starts.indexOf("a", starts.indexOf("a") + 1));
  });

  it("hands the slot to the waiting worktree between the holder's files", async () => {
    const { store, a, b, starts, isSlow, done } = await pair(() => 0);
    const record = a.runner.beforeRun;
    let held = false;
    a.runner.beforeRun = async (files) => {
      record?.(files);
      if (held || !isSlow(files)) return;
      held = true;
      // The other worktree comes to its slow tier while the first file runs, and misses the slot.
      void b.scheduler.start();
      const missed = JSON.stringify({ kind: "waiting", for: "slot" });
      await waitFor(() => JSON.stringify(readSlowActivity(store, b.worktreeId)) === missed, 60_000);
    };
    await a.scheduler.start();
    await waitFor(done, 90_000);
    expect(starts.slice(0, 2)).toEqual(["a", "b"]);
  });
});

describe("a slow run whose keyed input changed (spec 004 D4)", SLOW, () => {
  it("is discarded, never stored, and runs again at the new key", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(
      repo.main,
      store,
      repo.commonDir,
      options({ policy: slowPolicy([STRINGS]) }),
    );
    let firstKey: string | null = null;
    h.runner.beforeRun = (files) => {
      if (firstKey !== null || !files.some((f) => f.path === STRINGS)) return;
      firstKey = h.keyOf(STRINGS);
      // On disk only: the stability check finds it before the watcher would.
      h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase(); // moved\n");
    };
    await h.scheduler.start();
    await waitFor(() => h.runsOf(STRINGS).length === 2, 60_000);
    await h.scheduler.idle();
    expect(firstKey).not.toBeNull();
    expect(store.results.byKey(firstKey)).toEqual([]);
    expect(h.keyOf(STRINGS)).not.toBe(firstKey);
    expect(store.results.byKey(h.keyOf(STRINGS)).length).toBeGreaterThan(0);
  });
});

describe("inheriting a slow result (spec 004 D5, D6)", SLOW, () => {
  async function secondWorktree(inputs: PolicyInputs) {
    const repo = createRepo();
    const other = addWorktree(repo.main, repo.dir, "other");
    const store = openRepoStore(repo.commonDir);
    const policy = slowPolicy([STRINGS], inputs);
    const a = await openHarness(repo.main, store, repo.commonDir, options({ policy }));
    await a.scheduler.start();
    await a.scheduler.idle();
    expect(a.runsOf(STRINGS)).toHaveLength(1);
    const b = await openHarness(other, store, repo.commonDir, options({ policy }));
    await b.scheduler.start();
    await b.scheduler.idle();
    return { store, a, b };
  }

  it("never inherits a slow file without a declared artifact, and says so once", async () => {
    const { store, a, b } = await secondWorktree([]);
    expect(b.runsOf(STRINGS)).toHaveLength(1);
    // Fast files inherit as before.
    expect(b.runsOf("test/math.test.ts")).toEqual([]);
    const notes = readDaemonNotes(store, a.worktreeId).filter((n) =>
      n.text.includes("no declared artifact"),
    );
    expect(notes.map((n) => n.text)).toEqual([expect.stringContaining(`artifact: ${STRINGS}.`)]);
  });

  it("inherits a slow file whose declared inputs hold an artifact", async () => {
    const { store, a, b } = await secondWorktree({ [STRINGS]: ["src/math.ts"] });
    expect(b.runsOf(STRINGS)).toEqual([]);
    expect(
      readDaemonNotes(store, a.worktreeId).some((n) => n.text.includes("no declared artifact")),
    ).toBe(false);
  });
});
