import { appendFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { BACKLOG_QUIET_MS } from "../../src/core/scheduler/quiet.js";
import { cancelled } from "../../src/runners/vitest/run.js";
import { suite } from "./backlog-suite.js";
import { openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Row 011-94, test 8 of `tasks/011-82/design.md` row A (spec 011 C4 step 5
 * as amended 2026-10-21), on a real Vitest adapter: an edit cancels a
 * 30-file backlog tier, which a config edit queued, and a second edit 5 s
 * later finds the lane waiting for quiet, with no backlog run between them
 * to cancel. Before it, the backlog's tier started again right after the
 * first edit's. (A `run --all --force` backlog would not do: an edit leaves
 * a forced queued file forced, in the backlog.) Only the tier the edit
 * cancels runs 5 s files: 60 runs of them, the baseline's, the edits' and
 * the last backlog's too, took 125 s against the 120 s timeout at Vitest's
 * three workers on 4 CPUs (CI run 39695184172).
 */
const TIER_SIZE = 4;
const F0 = "test/f000.test.ts";

describe("a lane waits for quiet on a real Vitest adapter (row 011-94)", SLOW, () => {
  it("8: a backlog tier cancelled by an edit, then a second edit 5 s later: no backlog run between them", async () => {
    // 5 s each while `slow` exists: the edit lands before any file of the tier ends, at any width.
    const slow = join(tmpdir(), `squeal-011-94-${process.pid}-${Date.now()}.slow`);
    onTestFinished(() => rmSync(slow, { force: true }));
    const repo = suite(30, 5_000, undefined, slow);
    let offset = 0;
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
      tierSize: TIER_SIZE,
      backlogTierSize: 200,
      runnerPartBesideRun: true,
      now: () => Date.now() + offset,
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    const base = h.runner.runs.length;
    const started: string[][] = [];
    h.gate.before = (files) => {
      started.push(files.map((f) => f.path));
    };
    const edit = async (path: string) => {
      appendFileSync(join(repo.main, path), "// edited\n");
      await h.batch(path);
    };

    writeFileSync(slow, "");
    await edit("vitest.config.ts");
    await expect.poll(() => started.length, { timeout: 60_000 }).toBe(1);
    await edit(F0);
    rmSync(slow);
    await expect.poll(() => h.runsOf(F0).length, { timeout: 60_000 }).toBe(3);
    const backlog = h.runner.runs.slice(base).find((run) => run.files.length === 30);
    expect(backlog?.report.failure).toBe(cancelled("backlog"));

    // A file the first edit's tier left queued.
    const second = started[0]?.find((path) => !started[1]?.includes(path)) ?? "";
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    await edit(second);
    await expect.poll(() => h.runsOf(second).length, { timeout: 60_000 }).toBe(3);
    // The backlog's tier, then the two edits' tiers: red before row 011-94, the backlog's between them.
    expect(started.map((files) => files.length > TIER_SIZE)).toEqual([true, false, false]);
    expect(started[1]).toContain(F0);
    expect(started[2]).toContain(second);

    offset += BACKLOG_QUIET_MS;
    await h.scheduler.idle();
    expect(started.slice(3).some((files) => files.length > TIER_SIZE)).toBe(true);
    expect(h.header().counts).toMatchObject({ pending: 0, stale: 0, unknown: 0 });
  });
});
