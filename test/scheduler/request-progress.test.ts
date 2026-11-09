import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { TESTS_GROUP } from "../../src/core/types/scheduler.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { waitFor } from "../watcher/helpers.js";
import { SLOW } from "./cleanup.js";
import { createRepo, openRepoStore } from "./repo.js";
import { type Harness, openHarness } from "./vitest-harness.js";

/*
 * Row 018-12 (spec 018 wave 3.6): `Scheduler.requestProgress` counts the
 * ends of the test files an explicit request queued (`run --all`, `run
 * <group>`), which the idle exit takes as activity. The scheduler's own
 * work, a baseline's misses here, counts nothing. One file per backlog
 * tier, so the baseline's other files stay queued behind the held first
 * one. In the `basic` fixture two of the five files are slow.
 */

const SLOW_FILES = ["test/strings.test.ts", "test/upper.test.ts"];

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "squeal-018-12-"));
  dirs.push(dir);
  return dir;
}

/** A started scheduler whose baseline's first fast backlog tier is held; `release` lets it end. */
async function heldBaseline(): Promise<{ h: Harness; release: () => void }> {
  const repo = createRepo();
  const store = openRepoStore(repo.commonDir);
  const h = await openHarness(repo.main, store, repo.commonDir, {
    tierSize: 4,
    backlogTierSize: 1,
    policy: { ...RUN_MISSING, slow: { ...DEFAULT_POLICY.slow, include: SLOW_FILES } },
    slow: { slotDir: tempDir(), recheckMs: 50, load: () => [0], cpus: () => 1 },
    runnerPartBesideRun: true,
  });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  onTestFinished(() => release());
  let held = false;
  h.runner.beforeRun = async (files: readonly TestFileRef[]) => {
    if (held || files.some((f) => SLOW_FILES.includes(f.path))) return;
    held = true;
    await gate;
  };
  await h.scheduler.start();
  await waitFor(() => held, 60_000);
  return { h, release };
}

describe("Scheduler.requestProgress: ends of a request's files (row 018-12)", SLOW, () => {
  it("a baseline's misses ending count nothing", async () => {
    const { h, release } = await heldBaseline();
    expect(h.scheduler.requestProgress?.()).toBe(0);
    release();
    await h.scheduler.idle();
    await waitFor(() => !h.scheduler.slowPending(), 60_000);
    expect(h.scheduler.requestProgress?.()).toBe(0);
  });

  it("run tests counts each of its files once it ended", async () => {
    const { h, release } = await heldBaseline();
    const requested = await h.scheduler.requestGroup?.(TESTS_GROUP);
    // The three fast files: one held, two queued; none ended yet.
    expect(requested?.queued).toBe(3);
    expect(h.scheduler.requestProgress?.()).toBe(0);
    release();
    await h.scheduler.idle();
    expect(h.scheduler.requestProgress?.()).toBe(3);
    // A read counts nothing again.
    expect(h.scheduler.requestProgress?.()).toBe(3);
  });

  it("run --all counts each of its files once it ended, slow files included", async () => {
    const { h, release } = await heldBaseline();
    await h.scheduler.requestFullSuite();
    expect(h.scheduler.requestProgress?.()).toBe(0);
    release();
    await h.scheduler.idle();
    await waitFor(() => h.scheduler.requestProgress?.() === 5, 60_000);
  });
});
