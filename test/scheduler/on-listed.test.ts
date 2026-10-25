import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { listingMetaKey, parseListing } from "../../src/core/types/index.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Row 015-52 (coordinator 52e58f23, requests 07557174 and 9e9fe36a; 011
 * agreed): the ledger records a listing (`listingMetaKey`) only in the
 * transaction that applies a test file listing that did not fail, the
 * baseline's or a runner part's, and `SchedulerOptions.onListed` is called
 * once after it. A refined revision alone proves no listing (review 0.1.315
 * B2). A throw from the hook fails nothing.
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

/** A barrel harness whose `onListed` records the listing each call reads: the transaction is done. */
async function listing(over: { onListed?: () => void; allowErrors?: boolean } = {}) {
  const repo = createRepo("barrel");
  const store = openRepoStore(repo.commonDir);
  const calls: (string | null)[] = [];
  const fact = () => {
    const read = parseListing(store.meta.get(listingMetaKey(h.worktreeId)));
    return read === null ? null : `${read.revision}#${read.count}`;
  };
  const h: Harness = await openHarness(repo.main, store, repo.commonDir, {
    tierSize: 1,
    allowErrors: over.allowErrors ?? false,
    onListed:
      over.onListed ??
      (() => {
        calls.push(fact());
      }),
  });
  await h.scheduler.start();
  await h.scheduler.idle();
  return { h, calls, fact };
}

describe("scheduler: the listing and onListed (row 015-52)", SLOW, () => {
  it("records and calls once per listing, after the baseline and each runner part, never while it is pending", async () => {
    const { h, calls, fact } = await listing();
    const start = h.header().revision;
    expect(calls).toEqual([`${start}#1`]);

    const { held, release } = holdRefinement(h);
    h.write("test/added.test.ts", ADDED);
    await h.batch("test/added.test.ts");
    await held;
    await sleep(50);
    expect(h.header()).toMatchObject({ runnerPartPending: true, refinedRevision: start });
    expect(calls).toEqual([`${start}#1`]);

    release();
    await h.scheduler.idle();
    const added = h.header().revision;
    expect(h.header()).toMatchObject({ runnerPartPending: false, refinedRevision: added });
    expect(calls).toEqual([`${start}#1`, `${added}#2`]);
    expect(fact()).toBe(`${added}#2`);
  });

  it("records no listing for a refined revision whose listing failed, and records the one that recovers", async () => {
    const { h, calls, fact } = await listing({ allowErrors: true });
    const start = h.header().revision;
    h.runner.failing.add("testFiles");
    h.write("test/added.test.ts", ADDED);
    await h.batch("test/added.test.ts");
    await h.scheduler.idle();
    const added = h.header().revision;
    // Refined, so nothing reads as pending, but not listed.
    expect(h.header()).toMatchObject({ runnerPartPending: false, refinedRevision: added });
    expect(fact()).toBe(`${start}#1`);
    expect(calls).toEqual([`${start}#1`]);

    h.runner.failing.delete("testFiles");
    h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase() + '';\n");
    await h.batch("src/strings.ts");
    await h.scheduler.idle();
    const edited = h.header().revision;
    expect(fact()).toBe(`${edited}#2`);
    expect(calls).toEqual([`${start}#1`, `${edited}#2`]);
    expect(h.keyOf("test/added.test.ts")).not.toBeNull();
  });

  it("lists again after a runner part that threw before its listing was applied, and records none until then", async () => {
    const { h, calls, fact } = await listing({ allowErrors: true });
    const start = h.header().revision;
    let lists = 0;
    const testFiles = h.runner.testFiles;
    h.runner.testFiles = () => {
      lists++;
      return testFiles();
    };
    // The project reads as recreated, and its environment names a path outside the worktree:
    // keying it throws in `setEnvironments`, before `applyListing` (request e86a66d4).
    let broken = true;
    const invalidate = h.runner.invalidate;
    h.runner.invalidate = async (paths) => {
      const result = await invalidate(paths);
      return broken ? { ...result, recreatedProjects: [""] } : result;
    };
    const environment = h.runner.environment;
    h.runner.environment = async () => {
      const read = await environment();
      return broken
        ? read.map((e) => ({ ...e, files: [...e.files, "/outside/the/worktree.ts"] }))
        : read;
    };
    h.write("test/added.test.ts", ADDED);
    await h.batch("test/added.test.ts");
    await h.scheduler.idle();
    expect(h.errors.map((e) => e.message)).toEqual([
      expect.stringContaining("Invalid path '/outside'"),
    ]);
    expect(fact()).toBe(`${start}#1`);

    broken = false;
    const before = lists;
    h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase() + '';\n");
    await h.batch("src/strings.ts");
    await h.scheduler.idle();
    const edited = h.header().revision;
    expect(lists).toBe(before + 1);
    expect(fact()).toBe(`${edited}#2`);
    expect(calls).toEqual([`${start}#1`, `${edited}#2`]);
    expect(h.keyOf("test/added.test.ts")).not.toBeNull();
  });

  it("records the listing when onListed throws, and gives the throw to onError", async () => {
    let calls = 0;
    const { h, fact } = await listing({
      allowErrors: true,
      onListed: () => {
        calls++;
        throw new Error("code pass gone");
      },
    });
    h.write("test/added.test.ts", ADDED);
    await h.batch("test/added.test.ts");
    await h.scheduler.idle();

    const { revision } = h.header();
    expect(h.header()).toMatchObject({ runnerPartPending: false, refinedRevision: revision });
    expect(fact()).toBe(`${revision}#2`);
    expect(calls).toBe(2);
    expect(h.errors.map((e) => e.message)).toEqual(["code pass gone", "code pass gone"]);
    expect(h.keyOf("test/added.test.ts")).not.toBeNull();
  });
});
