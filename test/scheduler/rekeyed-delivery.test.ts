import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/index.js";
import { readRekeyed } from "../../src/core/scheduler/rekeyed-record.js";
import { createRepo, openHarness, openRepoStore, ref, SLOW } from "./helpers.js";

/*
 * Review wave 13u, B1 (task 001-238): a delivery's edit notes (tasks 001-223
 * and 001-224) count the files the scheduler's re-key attribution names
 * (task 001-186), which it keeps in the store (`recordRekeyed`). A consumer
 * registered before the first listing still counts a listed file its source
 * edit re-keyed, and never a file only the listing named.
 */

const MATH = "test/math.test.ts";

describe("edit notes over the scheduler's re-key record (task 001-238)", () => {
  it(
    "count a first-listed file a source edit re-keys, for a consumer registered before the listing",
    SLOW,
    async () => {
      const repo = createRepo();
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir);
      const { delivery, consumer } = await h.consumer();
      await h.scheduler.start();
      await h.scheduler.idle();
      expect(readRekeyed(h.store, h.worktreeId).size).toBe(0);
      expect((await delivery.onToolBoundary(consumer))?.sawEdit).toBeUndefined();

      h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // edited\n");
      await h.batch("src/math.ts");
      await h.scheduler.refined();

      const record = readRekeyed(h.store, h.worktreeId);
      expect([...record.keys()]).toEqual([testFileId(ref(MATH))]);
      const delta = await delivery.onToolBoundary(consumer);
      expect(delta?.sawEdit).toEqual({ queued: 1 });

      await h.scheduler.idle();
      expect(readRekeyed(h.store, h.worktreeId).get(testFileId(ref(MATH)))?.open).toBeNull();
    },
  );
});
