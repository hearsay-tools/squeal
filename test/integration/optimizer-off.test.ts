import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createVitestAdapter } from "../../src/runners/vitest/index.js";
import { openHarness, openRepoStore, SLOW } from "../scheduler/helpers.js";
import { SEPARATE } from "./optimizer-repo.js";
import {
  createRepo,
  freshOutcomes,
  NEW,
  OLD,
  slowOptions,
  stored,
  warmOptions,
  withSlowLanes,
} from "./stamps-repo.js";
import { OPTIMIZED } from "./touched-repo.js";

/*
 * Task 001-176: the regressions of reviews wave-13f B3 and S1 with Vitest's
 * dependency optimizer off. Each stores what a fresh adapter gives on the
 * bytes on disk, observed or not.
 */

const P_TEST = { project: "p", path: "test/optimized.test.ts" };
const ROOT_TEST = { project: "", path: "test/optimized.test.ts" };

/**
 * The reviewer's step 1: an adapter started while `src/mod.js` holds
 * `transient` runs project p's test and closes, leaving its optimizer cache;
 * then `OLD` is written back before anything else starts.
 */
async function builtOn(root: string, transient: string, observe: boolean): Promise<void> {
  const mod = join(root, "src/mod.js");
  writeFileSync(mod, transient);
  try {
    const adapter = await createVitestAdapter({ root, observe: () => observe });
    try {
      const report = await adapter.run([P_TEST], warmOptions(root));
      expect(report.results.map((r) => r.outcome)).toEqual(["pass"]);
    } finally {
      await adapter.close();
    }
  } finally {
    writeFileSync(mod, OLD);
  }
}

/** Every optimizer cache of the fixture: Vitest keeps a project's under the root's `node_modules`. */
const cacheOf = (root: string) => join(root, "node_modules/.vite");

describe("a separately configured project's optimizer across a restart (review wave-13f B3)", () => {
  it(
    "fails on the bytes on disk under a fresh adapter with no cache (the control)",
    SLOW,
    async () => {
      const repo = createRepo(SEPARATE);
      rmSync(cacheOf(repo.main), { recursive: true, force: true });
      expect(await freshOutcomes(repo.main, [P_TEST])).toEqual([
        ["p", "test/optimized.test.ts", "fail"],
      ]);
    },
  );

  it.each([true, false])(
    "runs the disk under a new adapter, a restarted scheduler and its forced checkpoint (observe %s)",
    SLOW,
    async (observe) => {
      const repo = createRepo(SEPARATE);
      await builtOn(repo.main, NEW, observe);
      expect(existsSync(cacheOf(repo.main))).toBe(true);

      expect(await freshOutcomes(repo.main, [P_TEST])).toEqual([
        ["p", "test/optimized.test.ts", "fail"],
      ]);

      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        observe,
      });
      await h.scheduler.start();
      await h.scheduler.idle();
      expect(stored(h)).toEqual([["p", "test/optimized.test.ts", "current", "fail"]]);
      const before = h.runsOf("test/optimized.test.ts").length;
      await h.scheduler.requestFullSuite({ force: true });
      await h.scheduler.idle();
      expect(h.runsOf("test/optimized.test.ts").length).toBeGreaterThan(before);
      expect(stored(h)).toEqual([["p", "test/optimized.test.ts", "current", "fail"]]);
    },
  );

  it.each([true, false])(
    "runs the disk in a slow instance made from the kept cache (observe %s)",
    SLOW,
    async (observe) => {
      const repo = createRepo(SEPARATE);
      const { slotDir, ...options } = slowOptions(["test/optimized.test.ts"]);
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        ...options,
        observe,
      });
      await builtOn(repo.main, NEW, observe);
      const lanes = withSlowLanes(h, repo.main, slotDir, async () => {});
      await h.scheduler.start();
      await h.scheduler.idle();
      expect(lanes.made()).toBeGreaterThan(0);
      expect(stored(h)).toEqual([["p", "test/optimized.test.ts", "current", "fail"]]);
    },
  );
});

describe("an ordinary edit of a source the optimizer bundled (review wave-13f S1)", () => {
  it("fails on the edited bytes under a fresh adapter (the control)", SLOW, async () => {
    const repo = createRepo(OPTIMIZED);
    expect(await freshOutcomes(repo.main, [ROOT_TEST])).toEqual([
      ["", "test/optimized.test.ts", "fail"],
    ]);
  });

  it.each([true, false])(
    "stores what the edited bytes give (observe %s)",
    SLOW,
    async (observe) => {
      const repo = createRepo({ ...OPTIMIZED, "src/mod.js": NEW });
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        observe,
      });
      await h.scheduler.start();
      await h.scheduler.idle();
      expect(stored(h)).toEqual([["", "test/optimized.test.ts", "current", "pass"]]);

      h.write("src/mod.js", OLD);
      await h.batch("src/mod.js");
      await h.scheduler.idle();
      expect(stored(h)).toEqual([["", "test/optimized.test.ts", "current", "fail"]]);
    },
  );
});
