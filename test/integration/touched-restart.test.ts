import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openHarness, openRepoStore, SLOW } from "../scheduler/helpers.js";
import { createRepo, freshOutcomes, NEW, OLD, stored } from "./stamps-repo.js";
import { OPTIMIZED, optimizeNow, warmOn } from "./touched-repo.js";

/*
 * Review wave-13e B3 (task 001-168): the optimizer's bundle of `src/mod.js`
 * is built on transient bytes and outlives the scheduler and adapter that
 * never heard the restore. A new adapter, and a new scheduler's forced
 * checkpoint, must build it again from the disk, not reuse it. Each check
 * starts from the stale bundle, copied aside after the first scheduler.
 */

const OPTIMIZED_TEST = { project: "", path: "test/optimized.test.ts" };

describe("optimizer output kept across a restart (review wave-13e B3)", () => {
  it(
    "fails on the bytes on disk under a fresh adapter with no cache (the control)",
    SLOW,
    async () => {
      const repo = createRepo(OPTIMIZED);
      rmSync(join(repo.main, "node_modules/.vite"), { recursive: true, force: true });
      expect(await freshOutcomes(repo.main, [OPTIMIZED_TEST])).toEqual([
        ["", "test/optimized.test.ts", "fail"],
      ]);
    },
  );

  it.each([true, false])(
    "is built again by a new adapter and a restarted scheduler (observe %s)",
    SLOW,
    async (observe) => {
      const repo = createRepo(OPTIMIZED);
      const store = openRepoStore(repo.commonDir);
      const cache = join(repo.main, "node_modules/.vite");
      const stale = join(repo.main, "node_modules/.vite-stale");
      const first = await openHarness(repo.main, store, repo.commonDir, { observe });
      const closure = first.runner.closure;
      let planted = false;
      first.runner.closure = async (testFile) => {
        if (!planted) {
          planted = true;
          const adapter = { ...first.runner, closure };
          await warmOn(first, adapter, [OPTIMIZED_TEST], "src/mod.js", NEW, OLD, () =>
            optimizeNow(first, adapter),
          );
        }
        return closure(testFile);
      };
      await first.scheduler.start();
      await first.scheduler.idle();
      expect(planted).toBe(true);
      // Shut down before the restore's batch came; the bundle stays on disk.
      await first.scheduler.close();
      await first.runner.close();
      expect(existsSync(cache)).toBe(true);
      cpSync(cache, stale, { recursive: true });

      expect(await freshOutcomes(repo.main, [OPTIMIZED_TEST])).toEqual([
        ["", "test/optimized.test.ts", "fail"],
      ]);

      rmSync(cache, { recursive: true, force: true });
      cpSync(stale, cache, { recursive: true });
      const second = await openHarness(repo.main, store, repo.commonDir, { observe });
      await second.scheduler.start();
      await second.scheduler.idle();
      await second.scheduler.requestFullSuite({ force: true });
      await second.scheduler.idle();
      expect(second.runsOf("test/optimized.test.ts").length).toBeGreaterThan(0);
      expect(stored(second)).toEqual([["", "test/optimized.test.ts", "current", "fail"]]);
    },
  );
});
