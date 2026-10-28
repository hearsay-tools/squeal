import { join } from "node:path";
import { expect, it } from "vitest";
import { observedMetaKey } from "../../src/core/keys/observed.js";
import { openHarness, openRepoStore, SLOW } from "./helpers.js";
import { A, B, DATA, fixture, scoped } from "./runtime-files-fixture.js";

it("stores both slow readers once at their effective keys", SLOW, async () => {
  const repo = fixture(false);
  const store = openRepoStore(repo.commonDir);
  const h = await openHarness(repo.main, store, repo.commonDir, {
    observe: true,
    policy: {
      ...scoped,
      slow: { ...scoped.slow, trigger: "idle", include: [A, B], maxParallel: 1 },
    },
    slow: { slotDir: join(repo.commonDir, "slots"), load: () => [0], cpus: () => 1 },
  });
  await h.scheduler.start();
  await expect
    .poll(() => store.testFileKeys.list(h.worktreeId).every((row) => row.pending === null), {
      timeout: 10_000,
    })
    .toBe(true);
  await h.scheduler.idle();
  const raw = JSON.parse(store.meta.get(observedMetaKey("")) ?? "{}");
  for (const path of [A, B]) {
    expect(h.runsOf(path)).toHaveLength(1);
    expect(raw[path]).toContain(DATA);
    expect(store.results.byKey(h.keyOf(path))).toEqual([
      expect.objectContaining({ outcome: "pass" }),
      expect.objectContaining({ outcome: "pass" }),
    ]);
  }
  expect(h.scheduler.extraFiles()).not.toContain(DATA);
  expect(await h.scheduler.requestSlowSuite()).toMatchObject({ queued: 0 });
});
