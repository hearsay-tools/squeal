import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { waitFor } from "../watcher/helpers.js";
import {
  addWorktree,
  createRepo,
  type Harness,
  type HarnessOptions,
  openHarness,
  openRepoStore,
  SLOW,
} from "./helpers.js";

/*
 * Spec 004 D2 as amended 2026-10-09 (task 004-34, lessons defect 3): when the
 * machine is idle a slow tier takes up to `slow.maxParallel` files at once,
 * holding as many of the user's slot permits. That it waits for its daemon's
 * fast backlog (004-60) is `slow-backlog.test.ts`. In the `basic` fixture `test/gen.test.ts`,
 * `test/math.test.ts` and `test/plain.test.ts` are fast here unless listed.
 */

const STRINGS = "test/strings.test.ts";
const UPPER = "test/upper.test.ts";
const PLAIN = "test/plain.test.ts";

const slotDirs: string[] = [];
afterEach(() => {
  for (const dir of slotDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function slotDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "squeal-004-34-slot-"));
  slotDirs.push(dir);
  return dir;
}

function options(
  include: readonly string[],
  maxParallel: number,
  extra: Partial<HarnessOptions> = {},
): HarnessOptions {
  return {
    tierSize: 4,
    policy: {
      ...RUN_MISSING,
      slow: { ...DEFAULT_POLICY.slow, trigger: "idle", include, maxParallel },
    },
    slow: { slotDir: slotDir(), recheckMs: 50, load: () => [0], cpus: () => 1 },
    runnerPartBesideRun: true,
    ...extra,
  };
}

const slowRunsOf = (h: Harness, slow: readonly string[]) =>
  h.runner.runs
    .map((run) => run.files.map((f) => f.path))
    .filter((files) => files.some((path) => slow.includes(path)));

describe("an idle slow tier takes several files (spec 004 D2, slow.maxParallel)", SLOW, () => {
  it("runs up to slow.maxParallel files in one tier once nothing fast is left", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const slow = [STRINGS, UPPER, PLAIN];
    const h = await openHarness(repo.main, store, repo.commonDir, options(slow, 2));
    const { delivery, consumer } = await h.consumer();
    await delivery.startTurn(consumer);
    await h.scheduler.start();
    await h.scheduler.idle();
    expect(slowRunsOf(h, slow)).toEqual([]);
    await delivery.endTurn(consumer);
    await waitFor(() => slowRunsOf(h, slow).flat().length === 3, 60_000);
    const widths = slowRunsOf(h, slow).map((files) => files.length);
    expect(widths).toEqual([2, 1]);
    const lanes = h.runner.runs
      .filter((run) => run.files.some((f) => slow.includes(f.path)))
      .map((run) => (run.options as { lane?: string }).lane);
    expect(lanes).toEqual(["slow:", "slow:"]);
  });

  it("runs one file per tier while the load is above slow.maxLoadPerCpu", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const slow = [STRINGS, UPPER];
    const base = options(slow, 4);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      ...base,
      policy: {
        ...RUN_MISSING,
        slow: { ...DEFAULT_POLICY.slow, trigger: "idle", include: slow, maxDeferMs: 300 },
      },
      slow: { slotDir: slotDir(), recheckMs: 50, load: () => [3], cpus: () => 1 },
    });
    await h.scheduler.start();
    await waitFor(() => slowRunsOf(h, slow).length === 2, 60_000);
    expect(slowRunsOf(h, slow).sort()).toEqual([[STRINGS], [UPPER]]);
  });
});

describe("two schedulers share slow.maxParallel permits (spec 004 D2)", SLOW, () => {
  it("runs at most slow.maxParallel slow files at once across both", async () => {
    const repo = createRepo();
    const other = addWorktree(repo.main, repo.dir, "other");
    const store = openRepoStore(repo.commonDir);
    const shared = slotDir();
    const slow = [STRINGS, UPPER];
    // Edited there, so neither inherits the other's slow results (004 D6).
    for (const file of slow) appendFileSync(join(other, file), "// other worktree\n");
    const extra = { slow: { slotDir: shared, recheckMs: 50, load: () => [0], cpus: () => 1 } };
    const a = await openHarness(repo.main, store, repo.commonDir, options(slow, 2, extra));
    const b = await openHarness(other, store, repo.commonDir, options(slow, 2, extra));
    let active = 0;
    let most = 0;
    for (const h of [a, b]) {
      const run = h.runner.run.bind(h.runner);
      h.runner.run = async (files, runOptions) => {
        const width = files.filter((f) => slow.includes(f.path)).length;
        active += width;
        most = Math.max(most, active);
        try {
          // Wide enough for an overlap to show.
          if (width > 0) await delay(400);
          return await run(files, runOptions);
        } finally {
          active -= width;
        }
      };
    }
    await Promise.all([a.scheduler.start(), b.scheduler.start()]);
    const done = (h: Harness) => slowRunsOf(h, slow).flat().length === 2;
    await waitFor(() => done(a) && done(b), 90_000);
    // Without shared permits each would run two at once, four in all.
    expect(most).toBe(2);
  });
});
