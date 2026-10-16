import { describe, expect, it } from "vitest";
import { slowCandidates } from "../../src/cli/warmup.js";
import { storePaths } from "../../src/core/store/index.js";
import { check, fakeRepo, seedStore } from "../status/helpers.js";
import { holdLock } from "../status/hold-lock.js";
import { result } from "../store/helpers.js";

const SLOW = "src/slow.test.ts";

/** Row 011-01 (issue 7, finding 3): the warm-up's slow-file suggestions beside a daemon's write. */
describe("the warm-up's slow candidates beside a store writer", () => {
  it("still lists a slow fast file while a second process holds the write lock", async () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    store.testFileKeys.upsertMany([
      {
        worktreeId: repo.mainId,
        testFile: { project: "", path: SLOW },
        key: "k",
        revision: 1,
        pending: null,
      },
    ]);
    store.results.putMany([{ ...result(check(SLOW, "takes long"), "k"), durationMs: 45_000 }]);
    store.close();
    const holder = await holdLock(storePaths(repo.commonDir).database, "immediate", 3_000);
    try {
      expect(slowCandidates(repo.main, repo.mainId)).toEqual([{ path: SLOW, durationMs: 45_000 }]);
    } finally {
      holder.child.kill();
      await holder.released;
    }
  });
});
