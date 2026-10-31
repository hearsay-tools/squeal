import { describe, expect, it } from "vitest";
import { promotionsMetaKey } from "../../src/core/scheduler/promotions.js";
import type { Policy } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { batchesOf, standingOf } from "./batch-fixture.js";
import {
  type CatchUpRepo,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
  sources,
  testFiles,
} from "./catch-up-fixture.js";
import { ref } from "./tier-yields-fixture.js";

/*
 * Row 011-283 (011-273 option B, `research/named-wait-rule.md` rule 3 and
 * F3; gh-116): the store holds a named wait's batches, so a daemon that
 * starts after a step-down takes over each batch whose files it queues
 * again at the same key, in their order, before its own, and republishes
 * them. A file whose key moved is no batch's. Probe P3 showed the
 * successor read none of the predecessor's row on 0.1.379.
 */
const FILES = testFiles(8, sources(4), () => 100);
const LOOKUP_ONLY: Partial<Policy> = { baseline: { onStart: "lookup-only" } };
const [F0, F2, F5, F7] = [
  "test/f000.test.ts",
  "test/f002.test.ts",
  "test/f005.test.ts",
  "test/f007.test.ts",
];
const sizes = { hostSlots: 4, backlogTierSize: 8 };

/**
 * A worktree whose files all ran, then a daemon whose backlog tier of an
 * environment re-key is held in flight while a wait promotes each of
 * `waits` in turn; a stop cancels it, so its rows stay `queued` (C9).
 */
async function steppedDown(waits: readonly (readonly string[])[]): Promise<CatchUpRepo> {
  const repo = catchUpRepo(FILES);
  const first = catchUpSide(repo, repo.main, { files: FILES, ...sizes, policy: RUN_MISSING });
  await first.scheduler.start();
  await first.scheduler.idle();
  await first.scheduler.close();
  const side = catchUpSide(repo, repo.main, { files: FILES, ...sizes, policy: LOOKUP_ONLY });
  await side.scheduler.start();
  await side.scheduler.idle();
  side.runner.hold();
  await side.edit("watch", "config.json");
  await expect.poll(() => side.runner.active).toBeGreaterThan(0);
  for (const paths of waits) {
    await side.scheduler.promote(
      paths.map((path) => ref(path)),
      600_000,
    );
  }
  expect([...batchesOf(side).values()].map((place) => place?.position)).toHaveLength(
    waits.flat().length,
  );
  await side.scheduler.close({ cancel: true });
  return repo;
}

/** The successor, its runs held from its start; `adapterVersion` "2" moves every key. */
async function successor(repo: CatchUpRepo, adapterVersion = "1"): Promise<CatchUpSide> {
  const next = catchUpSide(repo, repo.main, { files: FILES, ...sizes, policy: LOOKUP_ONLY });
  const environment = next.runner.environment;
  next.runner.environment = async () =>
    (await environment()).map((env) => ({ ...env, adapterVersion }));
  next.runner.hold();
  await next.scheduler.start();
  await expect.poll(() => next.runner.active).toBeGreaterThan(0);
  return next;
}

const runPaths = (side: CatchUpSide) => side.runner.runs.map((run) => run.files.map((f) => f.path));

describe("a successor takes over its predecessor's batches (row 011-283, tests 2 to 4)", {
  timeout: 120_000,
}, () => {
  it("2: the same keys: B's batch leads, the row is republished, and its wait reads it", async () => {
    const repo = await steppedDown([[F5]]);
    const next = await successor(repo);
    expect(runPaths(next)[0]).toEqual([F5]);
    expect(batchesOf(next).get(F5)).toMatchObject({ position: 1, of: 1, files: 1 });
    const standing = standingOf(next, F5);
    expect(standing.standing).toMatchObject({ kind: "running", batch: { position: 1, of: 1 } });
    next.runner.release();
    await next.scheduler.idle();
    expect(FILES.every((f) => next.current(f.path))).toBe(true);
    // B settled; its wait is open, so the row keeps it with no file of its own.
    expect(batchesOf(next).size).toBe(0);
  });

  it("3: B's key moved: no batch is taken over, and the predecessor's row is dropped", async () => {
    const repo = await steppedDown([[F5]]);
    const next = await successor(repo, "2");
    expect(runPaths(next)[0]).toHaveLength(FILES.length);
    expect(next.store.meta.get(promotionsMetaKey(next.worktreeId))).toBeNull();
    expect(standingOf(next, F5).standing).not.toHaveProperty("batch");
    next.runner.release();
    await next.scheduler.idle();
  });

  it("4: two batches keep their order, and a new wait's batch goes after both", async () => {
    const repo = await steppedDown([[F5], [F2, F0]]);
    const next = await successor(repo);
    await next.scheduler.promote([ref(F7)], 600_000);
    const places = batchesOf(next);
    expect(places.get(F5)).toMatchObject({ position: 1, of: 3 });
    expect(places.get(F2)).toMatchObject({ position: 2, of: 3, files: 2 });
    expect(places.get(F0)).toMatchObject({ position: 2, of: 3 });
    expect(places.get(F7)).toMatchObject({ position: 3, of: 3 });
    expect(runPaths(next)[0]).toEqual([F5]);
    next.runner.release();
    await expect.poll(() => next.runner.runs.length).toBeGreaterThan(1);
    expect([...(runPaths(next)[1] ?? [])].sort()).toEqual([F0, F2].sort());
    await next.scheduler.idle();
  });
});
