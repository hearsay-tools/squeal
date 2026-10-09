import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { acquireSlowSlot } from "../../src/core/slow/index.js";
import { readSlowActivity } from "../../src/core/slow/state.js";
import { readHeader, slowTierText } from "../../src/core/state/index.js";
import {
  DEFAULT_POLICY,
  type SlowTierActivity,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { waitFor } from "../watcher/helpers.js";
import {
  createRepo,
  type Harness,
  type HarnessOptions,
  openHarness,
  openRepoStore,
  SLOW,
} from "./helpers.js";

/*
 * Spec 004 D8: the slow tier publishes why its pending slow files wait, and
 * which one runs since when, for headers and status to read
 * (`src/core/slow/state.ts`). In the `basic` fixture the two files below are
 * marked slow; the others are fast.
 */

const STRINGS = "test/strings.test.ts";
const MATH = "test/math.test.ts";
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
    // A held run waits before the Vitest adapter's queue, as in its own slow lane (004-18).
    runnerPartBesideRun: true,
  };
}

async function harness(load = 0, dir?: string) {
  const repo = createRepo();
  const store = openRepoStore(repo.commonDir);
  const h = await openHarness(repo.main, store, repo.commonDir, options(load, dir));
  const activity = () => readSlowActivity(store, h.worktreeId);
  return { h, store, activity, repo };
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

/** Holds every run of one of `paths` until `release`; `held` names the files waiting. */
function hold(h: Harness, paths: readonly string[]) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = { held: [] as string[], release: () => release() };
  onTestFinished(() => release());
  const before = h.runner.beforeRun;
  h.runner.beforeRun = async (files) => {
    await before?.(files);
    const own = files.filter((f) => paths.includes(f.path)).map((f) => f.path);
    if (own.length === 0) return;
    state.held.push(...own);
    await gate;
    state.held = state.held.filter((path) => !own.includes(path));
  };
  return state;
}

/**
 * Review wave 2, B1: a slow file's activity goes when its run is recorded,
 * not at the slow tier's next selection, which waits for every fast tier.
 * The first slow file runs held; an edit's fast tier runs held beside it;
 * the slow file ends while the fast tier still runs.
 */
describe("the slow tier's activity when a slow run ends (review wave 2, B1)", SLOW, () => {
  /** `edit` may write a path the batch with the fast edit reports too; `""` for none. */
  async function slowEndsBesideFast(
    edit: (write: (path: string, content: string) => void) => string,
  ) {
    const { h, store, activity, repo } = await harness();
    // The header reads the slow tier from the policy at the root its `worktrees` row names.
    writeFileSync(
      join(h.root, "squeal.config.json"),
      JSON.stringify({ slow: { include: SLOW_FILES } }),
    );
    store.worktrees.upsert({
      id: h.worktreeId,
      root: h.root,
      commonDir: repo.commonDir,
      isMain: true,
      registeredAt: 1,
      daemon: null,
    });
    const slow = hold(h, SLOW_FILES);
    await h.scheduler.start();
    await expect.poll(() => slow.held.length, { timeout: 60_000 }).toBe(1);
    const first = slow.held[0] ?? "";
    const fast = hold(h, [MATH]);
    h.write("src/math.ts", "export const add = (a: number, b: number) => a + b + 1;\n");
    const edited = edit((path, content) => h.write(path, content));
    await h.batch("src/math.ts", ...(edited === "" ? [] : [edited]));
    await expect.poll(() => fast.held.length, { timeout: 60_000 }).toBe(1);
    const before = h.runsOf(first).length;
    slow.release();
    const pendingOf = (path: string) =>
      store.testFileKeys.list(h.worktreeId).find((r) => r.testFile.path === path)?.pending;
    await expect.poll(() => h.runsOf(first).length, { timeout: 60_000 }).toBe(before + 1);
    await expect.poll(() => pendingOf(first) !== "running", { timeout: 60_000 }).toBe(true);
    expect(fast.held).toEqual([MATH]);
    const line = slowTierText(readHeader(store, h.worktreeId), "squeal") ?? "";
    return { h, store, activity, first, fast, line, pendingOf };
  }

  it("says what the other slow file waits for, never that the finished one runs", async () => {
    const { activity, first, fast, line, pendingOf, h } = await slowEndsBesideFast(() => "");
    const second = SLOW_FILES.find((path) => path !== first) ?? "";
    expect(pendingOf(first)).toBeNull();
    expect(pendingOf(second)).toBe("queued");
    expect(activity()).toEqual({ kind: "waiting", for: "fast" });
    expect(line).not.toContain(`running ${first}`);
    expect(line).toContain("1 pending, waiting for fast test files");
    fast.release();
    await h.scheduler.idle();
  });

  it("says the same of a discarded run, its file queued again (control)", async () => {
    // Both slow files import `src/strings.ts`: the held run's input changes, so it is discarded.
    const { activity, first, fast, line, pendingOf, h } = await slowEndsBesideFast((write) => {
      write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase();\n// edited\n");
      return "src/strings.ts";
    });
    expect(pendingOf(first)).toBe("queued");
    expect(activity()).toEqual({ kind: "waiting", for: "fast" });
    expect(line).not.toContain(`running ${first}`);
    expect(line).toContain("2 pending, waiting for fast test files");
    fast.release();
    await h.scheduler.idle();
  });

  it("clears a running activity when the scheduler closes", async () => {
    const { h, activity } = await harness();
    const slow = hold(h, SLOW_FILES);
    await h.scheduler.start();
    await expect.poll(() => slow.held.length, { timeout: 60_000 }).toBe(1);
    expect(activity()).toMatchObject({ kind: "running" });
    const closed = h.scheduler.close();
    slow.release();
    await closed;
    expect(activity()).toBeNull();
  });
});
