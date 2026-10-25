import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Row 015-52 (agreed with coordinator 52e58f23, request 07557174; 011 told):
 * `SchedulerOptions.onRefined` is called once after each committed
 * transaction that records a refined revision, the baseline's and a
 * revision's runner part, so the code pass counts a file it held for its
 * listing. Never while that runner part is pending, and a throw from it
 * fails no refinement.
 *
 * Fixture `barrel`: `test/barrel.test.ts` imports `src/index.ts`, which
 * re-exports `src/math.ts` and `src/strings.ts`.
 */

const ADDED = 'import { it } from "vitest";\n\nit("is added", () => {});\n';

/** Holds the next refinement's `invalidate` until `release`; resolves `held` once it is there. */
function holdRefinement(h: Harness) {
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const invalidate = h.runner.invalidate;
  let once = true;
  h.runner.invalidate = async (paths) => {
    if (once) {
      once = false;
      reached();
      await released;
    }
    return invalidate(paths);
  };
  return { held, release };
}

describe("scheduler: onRefined (row 015-52)", SLOW, () => {
  it("is called once per refined commit, after the baseline and each runner part, never while it is pending", async () => {
    const repo = createRepo("barrel");
    const store = openRepoStore(repo.commonDir);
    const calls: (number | null)[] = [];
    let h: Harness | null = null;
    // Each call reads the refined revision the commit recorded: the transaction is done.
    const refined = () => h?.header().refinedRevision ?? null;
    h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 1,
      onRefined: () => calls.push(refined()),
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    const start = h.header().revision;
    expect(calls).toEqual([start]);

    const { held, release } = holdRefinement(h);
    h.write("test/added.test.ts", ADDED);
    await h.batch("test/added.test.ts");
    await held;
    await sleep(50);
    expect(h.header()).toMatchObject({ runnerPartPending: true, refinedRevision: start });
    expect(calls).toEqual([start]);

    release();
    await h.scheduler.idle();
    const added = h.header().revision;
    expect(h.header()).toMatchObject({ runnerPartPending: false, refinedRevision: added });
    expect(calls).toEqual([start, added]);
  });

  it("records the refined revision when onRefined throws, and gives the throw to onError", async () => {
    const repo = createRepo("barrel");
    const store = openRepoStore(repo.commonDir);
    let calls = 0;
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 1,
      allowErrors: true,
      onRefined: () => {
        calls++;
        throw new Error("code pass gone");
      },
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    h.write("test/added.test.ts", ADDED);
    await h.batch("test/added.test.ts");
    await h.scheduler.idle();

    const { revision } = h.header();
    expect(h.header()).toMatchObject({ runnerPartPending: false, refinedRevision: revision });
    expect(calls).toBe(2);
    expect(h.errors.map((e) => e.message)).toEqual(["code pass gone", "code pass gone"]);
    expect(h.keyOf("test/added.test.ts")).not.toBeNull();
  });
});
