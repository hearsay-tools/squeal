import { describe, expect, it } from "vitest";
import { readDaemonNotes } from "../../src/core/notes.js";
import type { TestFileRef } from "../../src/core/types/index.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Review wave 4.5, S6: the runner part of a revision is queued behind the
 * tier in flight. These cover the paths around that queue the earlier tests
 * did not: `run --all` behind a queued runner part with no runner failure, a
 * refinement that throws, and `close()` with runner work queued.
 *
 * Fixture `barrel`: `test/barrel.test.ts` takes 5 s; `test/math.test.ts`
 * imports `src/math.ts`.
 */

/** Resolves when the 5 s barrel tier starts; the runner part of later batches waits behind it. */
function barrelTierStarts(h: Harness): Promise<void> {
  return new Promise<void>((resolve) => {
    h.runner.beforeRun = (files) => {
      if (files.some((f) => f.path === "test/barrel.test.ts")) resolve();
    };
  });
}

async function duringBarrelTier(h: Harness): Promise<void> {
  const started = barrelTierStarts(h);
  h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase() + '';\n");
  await h.batch("src/strings.ts");
  await started;
}

describe("scheduler: work queued behind the runner part of a revision", SLOW, () => {
  it("records run --all after the queued runner part, at the revision it refined", async () => {
    const repo = createRepo("barrel");
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 1 });
    await h.scheduler.start();
    await h.scheduler.idle();
    await duringBarrelTier(h);
    const events: string[] = [];
    const invalidate = h.runner.invalidate;
    h.runner.invalidate = (paths) => {
      events.push(`invalidate ${paths.map((p) => p.path).join(",")}`);
      return invalidate(paths);
    };

    h.write("src/math.ts", "export const add = (a: number, b: number) => a + b + 0;\n");
    await h.batch("src/math.ts");
    const revision = store.revisions.latest(h.worktreeId)?.number ?? 0;
    const requested = h.scheduler.requestFullSuite().then((checkpoint) => {
      events.push("checkpoint");
      return checkpoint;
    });
    const checkpoint = await requested;
    await h.scheduler.idle();

    expect(events).toEqual(["invalidate src/math.ts", "checkpoint"]);
    expect(checkpoint).toMatchObject({ kind: "run-all", revision });
    const math: TestFileRef = { project: "", path: "test/math.test.ts" };
    expect(checkpoint.testFiles).toContainEqual(math);
    expect(store.checkpoints.get(checkpoint.id)).toMatchObject({ end: "completed" });
    expect(h.header()).toMatchObject({
      fullSuite: { atCurrentRevision: true },
      runnerPartPending: false,
    });
  });

  it("notes a refinement that throws, counts its revision as refined and keeps going", async () => {
    const repo = createRepo("barrel");
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 1,
      allowErrors: true,
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    const closure = h.runner.closure;
    let broken = true;
    // An absolute path in a closure cannot be keyed: the apply phase throws on it.
    h.runner.closure = async (testFile) => {
      const result = await closure(testFile);
      return broken ? { ...result, paths: [...result.paths, "/outside/the/worktree.ts"] } : result;
    };

    h.write("src/math.ts", "export const add = (a: number, b: number) => a + b + 0;\n");
    await h.batch("src/math.ts");
    const failed = store.revisions.latest(h.worktreeId)?.number ?? 0;
    await h.scheduler.idle();

    expect(h.errors.map((e) => e.message)).toEqual([
      expect.stringContaining('expected a worktree-relative path, got "/outside/the/worktree.ts"'),
    ]);
    const notes = readDaemonNotes(store, h.worktreeId).map((note) => note.text);
    expect(notes).toContainEqual(expect.stringMatching(`^could not apply revision ${failed}: `));
    expect(h.header()).toMatchObject({ refinedRevision: failed, runnerPartPending: false });

    broken = false;
    h.write("src/math.ts", "export const add = (a: number, b: number) => a + b;\n");
    await h.batch("src/math.ts");
    await h.scheduler.idle();
    expect(h.header()).toMatchObject({
      refinedRevision: failed + 1,
      counts: { pending: 0, stale: 0, unknown: 0 },
    });
  });

  it("closes with runner work queued: the tier finishes, the queued work is dropped", async () => {
    const repo = createRepo("barrel");
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 1 });
    await h.scheduler.start();
    await h.scheduler.idle();
    await duringBarrelTier(h);
    const invalidated: string[] = [];
    const invalidate = h.runner.invalidate;
    h.runner.invalidate = (paths) => {
      invalidated.push(...paths.map((p) => p.path));
      return invalidate(paths);
    };

    h.write("src/math.ts", "export const add = (a: number, b: number) => a + b + 0;\n");
    await h.batch("src/math.ts");
    const revision = store.revisions.latest(h.worktreeId)?.number ?? 0;
    // `run --all` after the queued runner part waits behind it too.
    const fullSuite = h.scheduler.requestFullSuite();
    const outcome = fullSuite.then(
      () => "recorded",
      (error: Error) => error.message,
    );
    const runs = h.runner.runs.length;

    await h.scheduler.close();
    await h.scheduler.idle();

    expect(await outcome).toBe("squeal scheduler: closed");
    expect(invalidated).toEqual([]);
    // The barrel tier in flight finished and was recorded; nothing ran after it.
    expect(h.runner.runs).toHaveLength(runs + 1);
    // The runner part never ran, and the store says so: it is still pending.
    expect(h.header()).toMatchObject({
      revision,
      refinedRevision: revision - 1,
      runnerPartPending: true,
    });
  });
});
