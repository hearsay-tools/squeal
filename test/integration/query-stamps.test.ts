import { describe, expect, it } from "vitest";
import type { RunnerAdapter, TestFileRef } from "../../src/core/types/index.js";
import { type Harness, openHarness, openRepoStore, SLOW } from "../scheduler/helpers.js";
import {
  BASE,
  createRepo,
  freshOutcomes,
  NEW,
  OLD,
  readsNew,
  slowOptions,
  stored,
  warmOptions,
  withSlowLanes,
} from "./stamps-repo.js";

/*
 * Review wave-13c B1, the reviewer's probe under the real scheduler, store
 * and Vitest adapter: `mod.ts?variant` is a module of its own, cached from
 * its own read. At the first run boundary the same adapter runs the test
 * while `src/mod.ts` holds bytes it passes on; the file is restored before
 * the scheduler's run, and nothing hashes it in between. The keys name the
 * restored bytes, so what is stored as current must be what they give.
 */

const VARIANT = { project: "", path: "test/variant.test.ts" };
const PLAIN = { project: "", path: "test/plain.test.ts" };

const QUERY: Readonly<Record<string, string>> = {
  ...BASE,
  "test/variant.test.ts": readsNew("../src/mod.ts?variant"),
};

/*
 * A plain import of the same file, beside the query, in one Vite container.
 * The plain module is loaded after the restore, so its read names the bytes
 * on disk; it must not stand for the variant read before.
 */
const PAIR: Readonly<Record<string, string>> = {
  ...QUERY,
  "test/plain.test.ts": readsNew("../src/mod.ts"),
};

/** Runs `variant` through `adapter` while `src/mod.ts` holds `NEW`, restores it, then runs `after`. */
async function plant(h: Harness, adapter: RunnerAdapter, after: readonly TestFileRef[] = []) {
  h.write("src/mod.ts", NEW);
  try {
    await adapter.run([VARIANT], warmOptions(h.root));
  } finally {
    h.write("src/mod.ts", OLD);
  }
  if (after.length > 0) await adapter.run(after, warmOptions(h.root));
}

/** Plants the variant in the scheduler's own adapter at its first run boundary, then runs to idle. */
async function probe(h: Harness, after: readonly TestFileRef[] = []): Promise<void> {
  const run = h.runner.run;
  let planted = false;
  h.runner.run = async (files, options) => {
    if (!planted) {
      planted = true;
      await plant(h, { ...h.runner, run }, after);
    }
    return run(files, options);
  };
  await h.scheduler.start();
  await h.scheduler.idle();
  expect(planted).toBe(true);
}

describe("a query-suffixed import (review wave-13c B1)", () => {
  it("fails on the bytes on disk under a fresh adapter (the control)", SLOW, async () => {
    const repo = createRepo(PAIR);
    expect(await freshOutcomes(repo.main, [VARIANT, PLAIN])).toEqual([
      ["", "test/plain.test.ts", "fail"],
      ["", "test/variant.test.ts", "fail"],
    ]);
  });

  it.each([true, false])(
    "stores no transient transform of its module as current (observe %s)",
    SLOW,
    async (observe) => {
      const repo = createRepo(QUERY);
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        observe,
      });
      await probe(h);
      expect(stored(h)).toEqual([["", "test/variant.test.ts", "current", "fail"]]);
    },
  );

  it.each([true, false])(
    "is checked against its own read, not the plain module's (observe %s)",
    SLOW,
    async (observe) => {
      const repo = createRepo(PAIR);
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        observe,
      });
      await probe(h, [PLAIN]);
      expect(stored(h)).toEqual([
        ["", "test/plain.test.ts", "current", "fail"],
        ["", "test/variant.test.ts", "current", "fail"],
      ]);
    },
  );

  // Spec 004 D2: the variant is planted in the slow instance's own cache, by
  // a public run of that very adapter before the scheduler's slow run.
  it.each([true, false])(
    "stores no transient transform as current in the slow instance (observe %s)",
    SLOW,
    async (observe) => {
      const repo = createRepo(PAIR);
      const { slotDir, ...options } = slowOptions(["test/variant.test.ts", "test/plain.test.ts"]);
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        ...options,
        observe,
      });
      const lanes = withSlowLanes(h, repo.main, slotDir, (adapter) => plant(h, adapter, [PLAIN]));
      await h.scheduler.start();
      await h.scheduler.idle();

      expect(lanes.made()).toBeGreaterThan(0);
      expect(stored(h)).toEqual([
        ["", "test/plain.test.ts", "current", "fail"],
        ["", "test/variant.test.ts", "current", "fail"],
      ]);
    },
  );
});
