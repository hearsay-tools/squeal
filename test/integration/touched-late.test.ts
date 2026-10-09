import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { git } from "../hash/git-repo.js";
import { openHarness, openRepoStore, SLOW } from "../scheduler/helpers.js";
import { createRepo, freshOutcomes, NEW, OLD, stored, withheldByBarrier } from "./stamps-repo.js";
import { VIRTUAL, warmOn } from "./touched-repo.js";

/*
 * Review wave-13e B2 (task 001-168): the scheduler's adapter caches the
 * virtual module on transient bytes, the disk is restored, and the tier
 * runs and ends before the restore's batch reaches the scheduler. The
 * completion barrier finds the touch first: nothing is stored under the key
 * that names the restored bytes, so neither this worktree's lookup after the
 * late batch nor another worktree's inherits the cached PASS.
 */

const ref = (path: string) => ({ project: "", path });
const VIRTUAL_TEST = ref("test/virtual.test.ts");
const PLAIN_TEST = ref("test/plain.test.ts");
const INPUTS = { inputs: ["src/mod.ts"] };

describe("a touch whose batch arrives after the run ended (review wave-13e B2)", () => {
  it("fails on the bytes on disk under a fresh adapter (the control)", SLOW, async () => {
    const repo = createRepo(VIRTUAL);
    expect(await freshOutcomes(repo.main, [VIRTUAL_TEST, PLAIN_TEST])).toEqual([
      ["", "test/plain.test.ts", "fail"],
      ["", "test/virtual.test.ts", "fail"],
    ]);
  });

  it.each([true, false])(
    "stores nothing a later lookup or another worktree inherits (observe %s)",
    SLOW,
    async (observe) => {
      const repo = createRepo(VIRTUAL);
      const store = openRepoStore(repo.commonDir);
      const options = { observe, tierSize: 4, runnerPartBesideRun: true, policy: INPUTS };
      const h = await openHarness(repo.main, store, repo.commonDir, options);
      const closure = h.runner.closure;
      let planted = false;
      h.runner.closure = async (testFile) => {
        if (!planted) {
          planted = true;
          const adapter = { ...h.runner, closure };
          await warmOn(h, adapter, [VIRTUAL_TEST], "src/mod.ts", NEW, OLD);
          await adapter.closure(PLAIN_TEST);
        }
        return closure(testFile);
      };
      await h.scheduler.start();
      await h.scheduler.idle();
      expect(planted).toBe(true);
      // The warm-up and the scheduled run.
      expect(h.runsOf("test/virtual.test.ts")).toHaveLength(2);

      // The restore's batch, late.
      await h.batch("src/mod.ts");
      await h.scheduler.idle();
      expect(stored(h)).toEqual([]);
      withheldByBarrier(h, "test/virtual.test.ts");
      const key = h.keyOf("test/virtual.test.ts");
      expect(key).not.toBeNull();
      expect(store.results.byKey(key ?? "", Date.now())).toEqual([]);

      // Inheritance: a worktree on the same bytes and store keys the file alike and runs it.
      const other = join(dirname(repo.main), randomUUID());
      git(repo.main, ["worktree", "add", "-q", "-b", "other", other]);
      const second = await openHarness(realpathSync(other), store, repo.commonDir, options);
      await second.scheduler.start();
      await second.scheduler.idle();
      expect(second.keyOf("test/virtual.test.ts")).toBe(key);
      expect(stored(second)).toEqual([
        ["", "test/plain.test.ts", "current", "fail"],
        ["", "test/virtual.test.ts", "current", "fail"],
      ]);
      expect(second.runsOf("test/virtual.test.ts")).toHaveLength(1);
    },
  );
});
