import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { DEFAULT_POLICY, type TestFileRef } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { waitFor } from "../watcher/helpers.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Spec 011 C9, "Unused", as amended 2026-10-21 (row 011-84, code row
 * 011-92): use is an edit, a wait, a request, and the work they caused,
 * queued or running: an edit's work, a promoted file, an open explicit
 * checkpoint, an open `run --slow` request, a new failure's re-run. The
 * rest of the queue (a baseline's misses, catch-up, slow files no request
 * asked for) is no use, queued or running. One file per backlog tier, so
 * the baseline's other files stay queued behind the held first one. In the
 * `basic` fixture two files are slow.
 */

const SLOW_FILES = ["test/strings.test.ts", "test/upper.test.ts"];

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "squeal-011-92-"));
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

describe("Scheduler.inUse: the backlog is no use (C9, row 011-92)", SLOW, () => {
  it("a baseline's misses are no use, queued or running, and name what stays queued", async () => {
    const { h, release } = await heldBaseline();
    expect(h.scheduler.inUse()).toBe(false);
    // One fast file runs; two fast and two slow files stay queued.
    expect(h.scheduler.queued()).toBe(4);
    release();
    await h.scheduler.idle();
    expect(h.scheduler.inUse()).toBe(false);
  });

  it("an edit's work is use until it ran", async () => {
    const { h, release } = await heldBaseline();
    h.write("test/plain.test.ts", 'import { it } from "vitest";\nit("edited", () => {});\n');
    await h.batch("test/plain.test.ts");
    expect(h.scheduler.inUse()).toBe(true);
    // The edit cancels the held backlog tier (C4 step 5); its held run ends at the release.
    release();
    await h.scheduler.idle();
    expect(h.runsOf("test/plain.test.ts").length).toBeGreaterThan(0);
    expect(h.scheduler.inUse()).toBe(false);
  });

  it("an open run --all is use until its files ran", async () => {
    const { h, release } = await heldBaseline();
    await h.scheduler.requestFullSuite();
    expect(h.scheduler.inUse()).toBe(true);
    release();
    await h.scheduler.idle();
    await waitFor(() => !h.scheduler.inUse(), 60_000);
  });

  it("an open run --slow is use; slow files no request asked for are not", async () => {
    const { h, release } = await heldBaseline();
    expect(h.scheduler.slowPending()).toBe(true);
    expect(h.scheduler.inUse()).toBe(false);
    await h.scheduler.requestSlowSuite();
    expect(h.scheduler.inUse()).toBe(true);
    release();
    await h.scheduler.idle();
    await waitFor(() => !h.scheduler.slowPending(), 60_000);
    expect(h.scheduler.inUse()).toBe(false);
  });

  it("a promoted file is use while it is queued", async () => {
    const { h, release } = await heldBaseline();
    await h.scheduler.promote([{ project: "", path: "test/math.test.ts" }], 60_000);
    expect(h.scheduler.inUse()).toBe(true);
    release();
    await h.scheduler.idle();
    expect(h.scheduler.inUse()).toBe(false);
  });
});
