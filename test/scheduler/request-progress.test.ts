import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
 * <group>`, a narrow run), which the idle exit takes as activity. The
 * scheduler's own work, a baseline's misses or an edit's run here, counts
 * nothing. One file per backlog tier, so the baseline's other files stay
 * queued behind the held first one. In the `basic` fixture two of the five
 * files are slow.
 */

const SLOW_FILES = ["test/strings.test.ts", "test/upper.test.ts"];
const MATH = "test/math.test.ts";

const dirs: string[] = [];
const gates: (() => void)[] = [];
// Before the scheduler's cleanup, which waits for the run a gate holds (hooks run as a stack).
afterEach(() => {
  for (const open of gates.splice(0)) open();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "squeal-018-12-"));
  dirs.push(dir);
  return dir;
}

/** A gate a run waits at until `open`; opened when the test ends. */
function gate(): { wait: Promise<void>; open: () => void; reached: boolean } {
  let open = () => {};
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  gates.push(open);
  return { wait, open, reached: false };
}

interface HeldBaseline {
  h: Harness;
  /** Lets the held first fast tier end. */
  release: () => void;
  /** With `holdSlow`: lets the slow runs end; `slowHeld` once one waits. */
  releaseSlow: () => void;
  slowHeld: () => boolean;
}

/** A started scheduler whose baseline's first fast backlog tier is held, and with `holdSlow` its slow runs. */
async function heldBaseline(holdSlow = false): Promise<HeldBaseline> {
  const repo = createRepo();
  const store = openRepoStore(repo.commonDir);
  const h = await openHarness(repo.main, store, repo.commonDir, {
    tierSize: 4,
    backlogTierSize: 1,
    policy: { ...RUN_MISSING, slow: { ...DEFAULT_POLICY.slow, include: SLOW_FILES } },
    slow: { slotDir: tempDir(), recheckMs: 50, load: () => [0], cpus: () => 1 },
    runnerPartBesideRun: true,
  });
  const fast = gate();
  const slow = gate();
  if (!holdSlow) slow.open();
  h.runner.beforeRun = async (files: readonly TestFileRef[]) => {
    if (files.some((f) => SLOW_FILES.includes(f.path))) {
      slow.reached = true;
      return slow.wait;
    }
    if (fast.reached) return;
    fast.reached = true;
    await fast.wait;
  };
  await h.scheduler.start();
  await waitFor(() => fast.reached, 60_000);
  return { h, release: fast.open, releaseSlow: slow.open, slowHeld: () => slow.reached };
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

  // Review wave 3.6, B1: a joined request owns its own files, never the open baseline's other lane.
  it("run --all --fast joined to the baseline counts its fast files, not the baseline's slow ones", async () => {
    const { h, release, releaseSlow } = await heldBaseline(true);
    const record = await h.scheduler.requestFullSuite({ lane: "fast" });
    expect(record.owner).not.toBe(record.id);
    release();
    await waitFor(() => h.store.checkpoints.get(record.id)?.end === "completed", 60_000);
    expect(h.scheduler.requestProgress?.()).toBe(3);
    releaseSlow();
    await waitFor(() => !h.scheduler.slowPending(), 60_000);
    await h.scheduler.idle();
    expect(h.scheduler.requestProgress?.()).toBe(3);
  });

  it("run --all --fast with nothing to run counts none of the open baseline's slow files", async () => {
    const { h, release, releaseSlow, slowHeld } = await heldBaseline(true);
    release();
    await waitFor(slowHeld, 60_000);
    const record = await h.scheduler.requestFullSuite({ lane: "fast" });
    expect(record.testFiles).toEqual([]);
    releaseSlow();
    await waitFor(() => !h.scheduler.slowPending(), 60_000);
    await h.scheduler.idle();
    expect(h.scheduler.requestProgress?.()).toBe(0);
  });

  // Review wave 3.6, B2: an end is recorded where it happens, before a re-queue can hide it.
  it("counts an end that a re-queue follows before any read, and nothing for the later run", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir);
    await h.scheduler.start();
    await h.scheduler.idle();
    await h.scheduler.requestGroupPaths?.(TESTS_GROUP, [MATH]);
    await h.scheduler.idle();
    expect(h.runsOf(MATH)).toHaveLength(1);
    const edit = gate();
    h.runner.beforeRun = async (files: readonly TestFileRef[]) => {
      if (!files.some((f) => f.path === MATH)) return;
      edit.reached = true;
      await edit.wait;
    };
    appendFileSync(join(repo.main, MATH), "// edited\n");
    await h.batch(MATH);
    await waitFor(() => edit.reached, 60_000);
    expect(h.scheduler.requestProgress?.()).toBe(1);
    edit.open();
    await h.scheduler.idle();
    expect(h.runsOf(MATH)).toHaveLength(2);
    expect(h.scheduler.requestProgress?.()).toBe(1);
  });
});
