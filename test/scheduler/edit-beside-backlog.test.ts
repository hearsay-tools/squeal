import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { createNodeTestRunners } from "../../src/core/daemon/node-test-runners.js";
import type {
  CheckKey,
  NodeTestProject,
  RunnerAdapter,
  RunOptions,
  RunReport,
  TestFileRef,
} from "../../src/core/types/index.js";
import { createRepo, type Harness, openHarness, openRepoStore } from "./helpers.js";

/*
 * Task 011-21, done-when 1 and 2 (spec 011 C4 step 5 as amended 2026-10-19,
 * `research/streaming-lanes.md` finding 4 (b)): node:test cannot cancel a
 * run, so an edit's tier of its lane starts beside the lane's backlog tier,
 * with no permit, instead of waiting for its end. A backlog file the edit
 * re-keyed runs to its end and is discarded at record; the others store.
 *
 * The baseline is the backlog: its first tier holds the eight files that
 * sleep 2 to 6 s (`runner.backlogTierSize` 8, path order), run
 * `runner.tierSize` 4 wide; the quick file stays queued behind them until an
 * edit reaches it. The pool holds 4 permits, all the backlog tier's. The
 * Vitest half, an edit cancelling a backlog tier, is `backlog-tiers.test.ts`,
 * unchanged.
 */
const NT: NodeTestProject = {
  name: "nt",
  cwd: "nt",
  node: process.execPath,
  argv: [],
  env: {},
  include: ["test/*.test.mjs"],
};
const QUICK = "nt/test/z.test.mjs";
const REKEYED = "nt/test/h3.test.mjs";
const BACKLOG = Array.from({ length: 8 }, (_, i) => `nt/test/h${i}.test.mjs`);
const sleeps = BACKLOG.map((_, i) => 2_000 + i * 570);

const test = (...body: string[]) =>
  [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    "const sleep = (ms) => new Promise((r) => setTimeout(r, ms));",
    ...body,
    "",
  ].join("\n");

function writeProject(root: string): void {
  // No Vitest files: the Vitest lane's own backlog tier would share the pool.
  rmSync(join(root, "test"), { recursive: true, force: true });
  mkdirSync(join(root, "nt/src"), { recursive: true });
  mkdirSync(join(root, "nt/test"), { recursive: true });
  writeFileSync(join(root, "nt/src/a.mjs"), "export const a = 1;\n");
  writeFileSync(join(root, "nt/src/b.mjs"), "export const b = 1;\n");
  writeFileSync(
    join(root, QUICK),
    test('import { a } from "../src/a.mjs";', 'test("a", () => assert.ok(a > 0));'),
  );
  for (const [i, path] of BACKLOG.entries()) {
    const imports = path === REKEYED ? ['import { b } from "../src/b.mjs";'] : [];
    const check = path === REKEYED ? "assert.ok(b > 0)" : "assert.ok(true)";
    writeFileSync(
      join(root, path),
      test(...imports, `test("sleeps", async () => { await sleep(${sleeps[i]}); ${check}; });`),
    );
  }
}

interface TimedRun {
  readonly files: readonly TestFileRef[];
  readonly runId: string;
  readonly start: number;
  end: number | null;
  report: RunReport | null;
}

const now = () => performance.now();

/** A harness over the daemon's node:test runner, not started; `runs` times each run. */
async function harness(): Promise<{ h: Harness; runs: TimedRun[] }> {
  const dir = join(mkdtempSync(join(tmpdir(), "squeal-beside-")), "squeal-uid");
  onTestFinished(() => rmSync(join(dir, ".."), { recursive: true, force: true }));
  const repo = createRepo("basic");
  writeProject(repo.main);
  const store = openRepoStore(repo.commonDir);
  const [nodeTest] = createNodeTestRunners([NT], {
    root: repo.main,
    store,
    tempDir: join(repo.main, ".."),
    tierSize: () => 4,
    note: () => {},
  });
  if (nodeTest === undefined) throw new Error("no node:test runner");
  const runs: TimedRun[] = [];
  const timed: RunnerAdapter = Object.create(nodeTest, {
    run: {
      value: async (files: readonly TestFileRef[], options: RunOptions) => {
        const run: TimedRun = {
          files,
          runId: options.runId,
          start: now(),
          end: null,
          report: null,
        };
        runs.push(run);
        const report = await nodeTest.run(files, options);
        run.end = now();
        run.report = report;
        return report;
      },
    },
  });
  const h = await openHarness(repo.main, store, repo.commonDir, {
    tierSize: 4,
    backlogTierSize: 8,
    adapters: [timed],
    capacity: { dir, hostSlots: 4 },
  });
  return { h, runs };
}

function outcome(h: Harness, path: string): string | undefined {
  return h.store.knownStates
    .list(h.worktreeId)
    .find((s) => s.check.testPath === path && s.check.kind === "test")?.outcome;
}

/** The key `path` of project `nt` has now (`Harness.keyOf` reads Vitest's project). */
function keyOf(h: Harness, path: string): CheckKey | null {
  const row = h.store.testFileKeys.list(h.worktreeId).find((r) => r.testFile.path === path);
  return row?.key ?? null;
}

/** Whether `run` stored a result under `key`, by default the key `path` has now. */
function storedBy(h: Harness, path: string, run: TimedRun, key = keyOf(h, path)): boolean {
  return h.store.results.byKey(key).some((r) => r.provenance.runId === run.runId);
}

const holds = (run: TimedRun, path: string) => run.files.some((f) => f.path === path);

/** Starts the scheduler; `edit` runs 300 ms after the backlog tier starts, then the backlog tier. */
async function editDuringBacklog(
  h: Harness,
  runs: TimedRun[],
  edit: () => Promise<number>,
): Promise<{ backlog: TimedRun; editedAt: number }> {
  let edited: Promise<number> | null = null;
  h.gate.before = (files) => {
    if (edited !== null || !files.some((f) => f.path === BACKLOG[0])) return;
    edited = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return edit();
    })();
  };
  await h.scheduler.start();
  await expect.poll(() => edited !== null, { timeout: 30_000 }).toBe(true);
  const editedAt = await (edited as unknown as Promise<number>);
  const backlog = runs.find((run) => holds(run, BACKLOG[0] ?? ""));
  if (backlog === undefined) throw new Error("no backlog tier ran");
  return { backlog, editedAt };
}

describe("scheduler: an edit's node:test tier beside the backlog tier (task 011-21)", () => {
  it("1. is current within its own run plus 1 s, before the backlog tier ends, and every backlog file stores", {
    timeout: 120_000,
  }, async () => {
    const { h, runs } = await harness();
    const { backlog, editedAt } = await editDuringBacklog(h, runs, async () => {
      h.write("nt/src/a.mjs", "export const a = 2;\n");
      const at = now();
      await h.batch("nt/src/a.mjs");
      return at;
    });
    expect(backlog.files.map((f) => f.path).sort()).toEqual(BACKLOG);
    const own = () => runs.find((run) => holds(run, QUICK));
    const current = () => {
      const run = own();
      return run !== undefined && storedBy(h, QUICK, run) && outcome(h, QUICK) === "pass";
    };
    await expect.poll(current, { timeout: 60_000, interval: 25 }).toBe(true);
    const currentAt = now();
    const edit = own();
    if (edit?.end == null) throw new Error("the edit's run did not end before its result");
    const ownMs = edit.end - edit.start;
    console.log(
      `011-21: the edit was current after ${Math.round(currentAt - editedAt)} ms, its own run ${Math.round(ownMs)} ms, ${Math.round(now() - backlog.start)} ms into the backlog tier`,
    );
    expect(currentAt - editedAt).toBeLessThanOrEqual(ownMs + 1_000);
    expect(backlog.end).toBeNull();

    await h.scheduler.idle();
    expect(backlog.report?.end).toBe("completed");
    for (const path of BACKLOG) {
      expect(storedBy(h, path, backlog), path).toBe(true);
      expect(outcome(h, path), path).toBe("pass");
      // Each ran once: nothing went back to the queue.
      expect(
        runs.filter((run) => holds(run, path)),
        path,
      ).toHaveLength(1);
    }
  });

  it("2. discards and re-queues a backlog file the edit re-keyed; the others store", {
    timeout: 120_000,
  }, async () => {
    const { h, runs } = await harness();
    let ranUnder: CheckKey | null = null;
    const { backlog } = await editDuringBacklog(h, runs, async () => {
      ranUnder = keyOf(h, REKEYED);
      h.write("nt/src/b.mjs", "export const b = 2;\n");
      const at = now();
      await h.batch("nt/src/b.mjs");
      return at;
    });
    expect(holds(backlog, REKEYED)).toBe(true);
    await h.scheduler.idle();

    expect(backlog.report?.end).toBe("completed");
    // The edit's run of the re-keyed file started beside the backlog tier, not after it.
    const again = runs.find((run) => run !== backlog && holds(run, REKEYED));
    if (again === undefined) throw new Error("the re-keyed file did not run again");
    expect(again.start).toBeLessThan(backlog.end ?? 0);
    // Its backlog run, under the old key, was discarded: the new key's result is the edit's run's.
    expect(ranUnder).not.toBeNull();
    expect(keyOf(h, REKEYED)).not.toBe(ranUnder);
    expect(storedBy(h, REKEYED, backlog, ranUnder)).toBe(false);
    expect(storedBy(h, REKEYED, again)).toBe(true);
    expect(outcome(h, REKEYED)).toBe("pass");
    // Re-queued at the record, it found the edit's result: no third run.
    expect(runs.filter((run) => holds(run, REKEYED))).toHaveLength(2);
    for (const path of BACKLOG) {
      if (path === REKEYED) continue;
      expect(storedBy(h, path, backlog), path).toBe(true);
      expect(outcome(h, path), path).toBe("pass");
    }
  });
});
