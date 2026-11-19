import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, onTestFinished } from "vitest";
import type { HostCpu } from "../../src/core/capacity/cores.js";
import { HOST_WINDOW_MIN_MS } from "../../src/core/capacity/pool.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { RunOptions } from "../../src/core/types/runner.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { SLOW } from "./cleanup.js";
import { createRepo, openRepoStore } from "./repo.js";
import { openHarness } from "./vitest-harness.js";

/*
 * Row 011-412 (spec 021 D18 Rule: "Edit tiers, named waits, checkpoints and
 * agents' own runs stay outside it"; 011 C15): the host reads 20 busy of 24
 * CPUs, above the background ceiling of 18. A backlog tier runs on the
 * floor's one permit. The same files promoted by a named wait form a batch
 * whose tier takes the slot-based gate a checkpoint takes: all 4 slots.
 * Before the repair the batch asked as a backlog tier; the ceiling left it
 * 1 permit, less than an edit's tier, so it ran as an edit's, ungranted.
 */

const ref = (path: string): TestFileRef => ({ project: "", path });
const OTHERS = [
  "test/gen.test.ts",
  "test/plain.test.ts",
  "test/strings.test.ts",
  "test/upper.test.ts",
];

describe("scheduler: a named wait's batch and the background ceiling (row 011-412)", SLOW, () => {
  it("at 20 busy of 24 CPUs a backlog tier gets the floor's one permit, a named wait's batch its slots", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "squeal-batch-ceiling-")), "squeal-uid");
    onTestFinished(() => rmSync(join(dir, ".."), { recursive: true, force: true }));
    const host: HostCpu = { read: () => 20 };
    const repo = createRepo("basic");
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      backlogTierSize: 50,
      // 24 CPUs on any machine: the ceiling is 18 (0.75 of 24), below the 20 busy.
      capacity: { dir, hostSlots: 4, host, cpus: 24 },
      policy: RUN_MISSING,
    });
    const runs: { files: readonly TestFileRef[]; options: RunOptions }[] = [];
    h.gate.before = (files, options) => {
      runs.push({ files, options });
    };
    await h.scheduler.start();
    await h.quiet();
    // The tree's first window: the gate reads the host again a second after the last read.
    await delay(HOST_WINDOW_MIN_MS + 100);

    // The backlog: an environment change re-keys every file; the ceiling refuses all but the floor.
    runs.length = 0;
    appendFileSync(join(h.root, "vitest.config.ts"), "// environment change\n");
    await h.batch("vitest.config.ts");
    await h.quiet();
    expect(runs.length).toBeGreaterThan(0);
    expect(Math.max(...runs.map((r) => r.options.workers ?? 0))).toBe(1);

    // An edit's tier of math.test.ts holds the lane while the environment changes again, so the
    // other four files wait queued; a named wait then promotes them into one batch.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    runs.length = 0;
    h.gate.before = async (files, options) => {
      runs.push({ files, options });
      if (files.some((f) => f.path === "test/math.test.ts")) await held;
    };
    appendFileSync(join(h.root, "test/math.test.ts"), "// an edit\n");
    await h.batch("test/math.test.ts");
    await expect.poll(() => runs.length).toBe(1);
    appendFileSync(join(h.root, "vitest.config.ts"), "// another environment change\n");
    await h.batch("vitest.config.ts");
    await h.scheduler.promote(OTHERS.map(ref), 600_000);
    await delay(HOST_WINDOW_MIN_MS + 100);
    release();
    await h.quiet();

    const ofBatch = runs.filter((r) => r.files.some((f) => OTHERS.includes(f.path)));
    expect(ofBatch.flatMap((r) => r.files.map((f) => f.path)).toSorted()).toEqual(
      expect.arrayContaining(OTHERS),
    );
    // Outside the ceiling: the batch's tier is granted the 4 slots, not the floor's 1 or none.
    expect(ofBatch[0]?.options.workers).toBe(4);
  });
});
