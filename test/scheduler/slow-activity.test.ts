import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireSlowSlot } from "../../src/core/slow/index.js";
import { readSlowActivity } from "../../src/core/slow/state.js";
import {
  DEFAULT_POLICY,
  type SlowTierActivity,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { waitFor } from "../watcher/helpers.js";
import { createRepo, type HarnessOptions, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Spec 004 D8: the slow tier publishes why its pending slow files wait, and
 * which one runs since when, for headers and status to read
 * (`src/core/slow/state.ts`). In the `basic` fixture the two files below are
 * marked slow; the others are fast.
 */

const STRINGS = "test/strings.test.ts";
const UPPER = "test/upper.test.ts";
const SLOW_FILES = [STRINGS, UPPER];

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function slotDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "squeal-004-15-slot-"));
  dirs.push(dir);
  return dir;
}

function options(load = 0, dir = slotDir()): HarnessOptions {
  return {
    tierSize: 4,
    policy: { slow: { ...DEFAULT_POLICY.slow, include: SLOW_FILES } },
    slow: { slotDir: dir, recheckMs: 50, load: () => [load], cpus: () => 1 },
  };
}

async function harness(load = 0, dir?: string) {
  const repo = createRepo();
  const store = openRepoStore(repo.commonDir);
  const h = await openHarness(repo.main, store, repo.commonDir, options(load, dir));
  const activity = () => readSlowActivity(store, h.worktreeId);
  return { h, store, activity };
}

describe("the slow tier's published activity (spec 004 D8)", SLOW, () => {
  it("waits for the agent to pause while a consumer is in a turn", async () => {
    const { h, activity } = await harness();
    const { delivery, consumer } = await h.consumer();
    await delivery.startTurn(consumer);
    await h.scheduler.start();
    await waitFor(() => activity()?.kind === "waiting", 60_000);
    expect(activity()).toEqual({ kind: "waiting", for: "idle" });
  });

  it("waits for the slot another daemon holds", async () => {
    const dir = slotDir();
    const held = acquireSlowSlot({ dir, owner: { pid: process.pid, worktreeId: "other" } });
    try {
      const { h, activity } = await harness(0, dir);
      await h.scheduler.start();
      await waitFor(() => activity()?.kind === "waiting", 60_000);
      expect(activity()).toEqual({ kind: "waiting", for: "slot" });
    } finally {
      held?.release();
    }
  });

  it("waits for load while the guard defers", async () => {
    const { h, activity } = await harness(8);
    await h.scheduler.start();
    await waitFor(() => activity()?.kind === "waiting", 60_000);
    expect(activity()).toEqual({ kind: "waiting", for: "load" });
  });

  it("names the running file since when with its last duration, and clears when drained", async () => {
    const { h, activity } = await harness();
    const seen: (SlowTierActivity | null)[] = [];
    h.runner.beforeRun = (files: readonly TestFileRef[]) => {
      if (files.some((f) => SLOW_FILES.includes(f.path))) seen.push(activity());
    };
    const before = Date.now();
    await h.scheduler.start();
    await waitFor(() => seen.length === 2, 60_000);
    await h.scheduler.idle();
    for (const entry of seen) {
      expect(entry).toMatchObject({ kind: "running", lastDurationMs: null });
      if (entry?.kind !== "running") continue;
      expect(SLOW_FILES).toContain(entry.path);
      expect(entry.since).toBeGreaterThanOrEqual(before);
    }
    await waitFor(() => activity() === null, 10_000);
  });
});
