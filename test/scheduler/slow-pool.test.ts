import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { createPermitPool } from "../../src/core/capacity/index.js";
import { DEFAULT_POLICY, type RunOptions } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { waitFor } from "../watcher/helpers.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Task 001-386 (review 001-384 S1, settled by the human): slow tiers, idle
 * and checkpoint, take their workers from the per-user pool of 001 D11
 * Capacity, `slow.maxWorkers` (2) per file. The slow lane keeps its own
 * `slow.maxParallel` permits in their own directory (004 D2), and the pool
 * is the scheduler's, in a directory of its own here as a nested daemon's
 * would be (004-16). In the `basic` fixture these three files are slow.
 */

const SLOW_FILES = ["test/strings.test.ts", "test/upper.test.ts", "test/plain.test.ts"];

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `squeal-slow-pool-${name}-`));
  dirs.push(dir);
  return dir;
}

async function open(poolDir: string): Promise<Harness> {
  const repo = createRepo();
  const store = openRepoStore(repo.commonDir);
  return openHarness(repo.main, store, repo.commonDir, {
    tierSize: 4,
    policy: {
      ...RUN_MISSING,
      slow: { ...DEFAULT_POLICY.slow, include: SLOW_FILES, maxParallel: 4 },
    },
    slow: { slotDir: tempDir("slot"), recheckMs: 50, load: () => [0], cpus: () => 1 },
    runnerPartBesideRun: true,
    capacity: { dir: poolDir, hostSlots: 8 },
  });
}

const slowRuns = (h: Harness): { files: string[]; options: RunOptions }[] =>
  h.runner.runs
    .map((run) => ({ files: run.files.map((f) => f.path), options: run.options as RunOptions }))
    .filter((run) => run.files.some((path) => SLOW_FILES.includes(path)));

describe("slow tiers take their workers from the per-user pool (task 001-386)", SLOW, () => {
  it("a slow tier on a free host takes slow.maxWorkers workers for each of its files", async () => {
    const poolDir = join(tempDir("pool"), "squeal-uid");
    const h = await open(poolDir);
    await h.scheduler.start();
    await waitFor(() => slowRuns(h).flatMap((r) => r.files).length === 3, 60_000);
    await h.scheduler.idle();
    for (const run of slowRuns(h)) expect(run.options.workers).toBe(2 * run.files.length);
  });

  it("runs one file at a time on the one permit another daemon leaves free", async () => {
    const poolDir = join(tempDir("pool"), "squeal-uid");
    const other = createPermitPool({
      dir: poolDir,
      owner: { pid: process.pid, worktreeId: "other-daemon" },
      hostSlots: 8,
    });
    onTestFinished(() => other.close());
    const lease = other.acquire(200);
    // Every worker is a permit (011 C10 as amended 2026-10-21, row 011-96): one is left free.
    lease?.shrinkTo(7);
    expect(lease?.grant).toBe(7);
    const h = await open(poolDir);
    await h.scheduler.start();
    await waitFor(() => slowRuns(h).flatMap((r) => r.files).length === 3, 60_000);
    await h.scheduler.idle();
    // Without the pool the idle tier would take all three files at once (slow.maxParallel 4).
    expect(slowRuns(h).map((r) => [r.files.length, r.options.workers])).toEqual([
      [1, 1],
      [1, 1],
      [1, 1],
    ]);
  });
});
