import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { readDaemonNotes } from "../../src/core/notes.js";
import { readSlowActivity } from "../../src/core/slow/state.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { waitFor } from "../watcher/helpers.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Spec 004 D3 as amended 2026-10-14 (task 004-59, found by 006-54): an
 * explicit `run --slow` skips the load guard for the tier it starts, so the
 * status line's "`squeal run --slow` runs them now" holds; the idle trigger
 * still waits for the load, up to the default `slow.maxDeferMs` (10 minutes).
 * The load is injected at 8 per CPU and never drops.
 */

const SLOW_FILES = ["test/strings.test.ts", "test/upper.test.ts"];

const slotDirs: string[] = [];
afterEach(() => {
  for (const dir of slotDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function loaded() {
  const repo = createRepo();
  const store = openRepoStore(repo.commonDir);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-004-59-slot-"));
  slotDirs.push(slotDir);
  let reads = 0;
  const h = await openHarness(repo.main, store, repo.commonDir, {
    tierSize: 4,
    policy: { ...RUN_MISSING, slow: { ...DEFAULT_POLICY.slow, include: SLOW_FILES } },
    slow: {
      slotDir,
      recheckMs: 25,
      load: () => {
        reads += 1;
        return [8];
      },
      cpus: () => 1,
    },
  });
  // Every slow tier's width, in the order they started.
  const widths: number[] = [];
  h.runner.beforeRun = (files) => {
    const slow = files.filter((f) => SLOW_FILES.includes(f.path));
    if (slow.length > 0) widths.push(slow.length);
  };
  await h.scheduler.start();
  return { h, store, widths, reads: () => reads };
}

const slowRuns = (h: Harness) => SLOW_FILES.flatMap((path) => h.runsOf(path)).length;

describe("run --slow under load (spec 004 D3 as amended, task 004-59)", SLOW, () => {
  it("defers the idle trigger, and a request runs the files at once without a load note", async () => {
    const { h, store, widths, reads } = await loaded();
    // No consumer: the idle trigger holds, and the guard reads the high load.
    await waitFor(() => reads() >= 3, 60_000);
    await delay(300);
    expect(slowRuns(h)).toBe(0);
    expect(readSlowActivity(store, h.worktreeId)).toEqual({ kind: "waiting", for: "load" });

    const asked = performance.now();
    expect(await h.scheduler.requestSlowSuite()).toMatchObject({ queued: 2 });
    await waitFor(() => slowRuns(h) === 2, 30_000);
    // Far below the default slow.maxDeferMs the guard would have spent.
    expect(performance.now() - asked).toBeLessThan(30_000);
    await h.scheduler.idle();
    // Under load D2's idle width does not hold: one file at a time, within the permits.
    expect(widths).toEqual([1, 1]);
    expect(
      readDaemonNotes(store, h.worktreeId).some((n) => n.text.includes("ran under load")),
    ).toBe(false);
  });

  it("closes with the pass: the next slow files on the idle trigger wait for the load again", async () => {
    const { h, store, reads } = await loaded();
    await h.scheduler.requestSlowSuite();
    await waitFor(() => slowRuns(h) === 2, 30_000);
    await h.scheduler.idle();

    // An edit re-queues both slow files with no request open.
    h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase(); // edited\n");
    await h.batch("src/strings.ts");
    const before = reads();
    await waitFor(() => reads() >= before + 3, 60_000);
    await delay(300);
    expect(slowRuns(h)).toBe(2);
    expect(readSlowActivity(store, h.worktreeId)).toEqual({ kind: "waiting", for: "load" });
  });
});
