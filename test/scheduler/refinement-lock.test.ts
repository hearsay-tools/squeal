import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Review wave 4.5, S3 and probe G: the runner part of a revision held the
 * scheduler lock across its runner calls, so a batch that arrived during a
 * refinement waited for it, up to 1.3 s on this repository. Spec 001 D2:
 * "Creating a revision never waits on the runner".
 *
 * Fixture `barrel`: `test/barrel.test.ts` imports `src/index.ts`, which
 * re-exports `src/math.ts` and `src/strings.ts`; `test/math.test.ts` imports
 * `src/math.ts`.
 */
describe("scheduler: revisions during a refinement (D2, review wave 4.5 S3)", SLOW, () => {
  it("stores a revision within 500 ms while the runner part of an earlier one waits on the runner", async () => {
    const repo = createRepo("barrel");
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 1 });
    await h.scheduler.start();
    await h.scheduler.idle();

    // The next refinement's `invalidate` takes 2 s, as a full invalidation after an add can.
    let slowed: () => void = () => {};
    const inRefinement = new Promise<void>((resolve) => {
      slowed = resolve;
    });
    const invalidate = h.runner.invalidate;
    let slow = true;
    h.runner.invalidate = async (paths) => {
      if (slow) {
        slow = false;
        slowed();
        await sleep(2_000);
      }
      return invalidate(paths);
    };

    h.write("test/added.test.ts", 'import { it } from "vitest";\n\nit("is added", () => {});\n');
    await h.batch("test/added.test.ts");
    const added = store.revisions.latest(h.worktreeId)?.number ?? 0;
    await inRefinement;

    h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase() + '';\n");
    const before = performance.now();
    await h.batch("src/strings.ts");
    expect(performance.now() - before).toBeLessThan(500);
    expect(store.revisions.latest(h.worktreeId)?.number).toBe(added + 1);
    expect(h.header()).toMatchObject({
      revision: added + 1,
      refinedRevision: added - 1,
      runnerPartPending: true,
    });

    await h.scheduler.idle();
    expect(h.header()).toMatchObject({
      revision: added + 1,
      refinedRevision: added + 1,
      runnerPartPending: false,
      counts: { pending: 0, stale: 0, unknown: 0 },
    });
    expect(h.runsOf("test/added.test.ts")).toHaveLength(1);
    expect(h.keyOf("test/barrel.test.ts")).not.toBeNull();
  });

  it("re-resolves a closure whose files changed while the runner resolved it", async () => {
    const repo = createRepo("barrel");
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 1 });
    await h.scheduler.start();
    await h.scheduler.idle();

    let resolving: () => void = () => {};
    const inClosure = new Promise<void>((resolve) => {
      resolving = resolve;
    });
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const closure = h.runner.closure;
    h.runner.closure = async (testFile) => {
      const result = await closure(testFile);
      if (testFile.path === "test/added.test.ts") {
        resolving();
        await released;
      }
      return result;
    };

    h.write(
      "test/added.test.ts",
      'import { expect, it } from "vitest";\nimport { add } from "../src/math.ts";\n\nit("adds", () => expect(add(1, 1)).toBe(2));\n',
    );
    await h.batch("test/added.test.ts");
    await inClosure;
    // The test file changes its import after the runner resolved its closure, before it is applied.
    h.write(
      "test/added.test.ts",
      'import { expect, it } from "vitest";\nimport { upper } from "../src/strings.ts";\n\nit("upper", () => expect(upper("a")).toBe("A"));\n',
    );
    const before = performance.now();
    await h.batch("test/added.test.ts");
    expect(performance.now() - before).toBeLessThan(500);
    release();
    await h.scheduler.idle();

    const row = store.testFiles.get({ project: "", path: "test/added.test.ts" });
    expect(row?.closure.paths).toContain("src/strings.ts");
    expect(row?.closure.paths).not.toContain("src/math.ts");
    expect(h.header()).toMatchObject({ runnerPartPending: false, counts: { pending: 0 } });
    const states = store.knownStates
      .list(h.worktreeId)
      .filter((s) => s.check.testPath === "test/added.test.ts");
    expect(states.map((s) => [s.check.kind === "test" ? s.check.fullName : "", s.outcome])).toEqual(
      expect.arrayContaining([["upper", "pass"]]),
    );
  });
});
