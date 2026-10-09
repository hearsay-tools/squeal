import { describe, expect, it } from "vitest";
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
  withSlowLanes,
} from "./stamps-repo.js";

/*
 * Review wave-13 B2, the reviewer's probe under the real scheduler, store and
 * Vitest adapter: a project configured through its own config file has a
 * Vite server of its own. While the first closure walk runs, `src/mod.ts`
 * holds bytes the test passes on, and is restored to bytes it fails on
 * before anything hashes it again. The scheduler's keys name the restored
 * bytes, so what it stores as current must be what they give: the file
 * loads, and its test fails.
 */

const config = (body: string) =>
  `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: ${body} });\n`;

const FILES: Readonly<Record<string, string>> = {
  ...BASE,
  "vitest.config.ts": config('{ projects: ["./vitest.unit.config.ts"] }'),
  "vitest.unit.config.ts": config('{ name: "unit", include: ["test/*.test.ts"] }'),
  "test/mod.test.ts": readsNew("../src/mod.ts"),
};

/*
 * Review wave-13b B2: two projects with config files of their own, so two
 * Vite servers, import the same module. The first closure walk caches the
 * transient bytes in one server; the other loads the restored bytes after.
 * Each server's transform is checked against what that server read.
 */
const project = (name: string) => config(`{ name: "${name}", include: ["test/*.test.ts"] }`);
const TWO: Readonly<Record<string, string>> = {
  ...FILES,
  "vitest.config.ts": config('{ projects: ["./vitest.a.config.ts", "./vitest.b.config.ts"] }'),
  "vitest.unit.config.ts": "",
  "vitest.a.config.ts": project("a"),
  "vitest.b.config.ts": project("b"),
};

const A = { project: "a", path: "test/mod.test.ts" };
const B = { project: "b", path: "test/mod.test.ts" };

/**
 * The reviewer's probe: the first closure walk reads `src/mod.ts` while it
 * holds the bytes the test passes on, and it is restored before anything
 * hashes it again. Then the scheduler runs to idle.
 */
async function probe(h: Harness): Promise<void> {
  const closure = h.runner.closure;
  let transient = true;
  h.runner.closure = async (testFile) => {
    if (!transient) return closure(testFile);
    transient = false;
    h.write("src/mod.ts", NEW);
    try {
      return await closure(testFile);
    } finally {
      h.write("src/mod.ts", OLD);
    }
  };
  await h.scheduler.start();
  await h.scheduler.idle();
  expect(transient).toBe(false);
}

describe("a project with its own config file (review wave-13 B2)", () => {
  it.each([true, false])(
    "stores no transform read during a closure walk as current (observe %s)",
    SLOW,
    async (observe) => {
      const repo = createRepo(FILES);
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        observe,
      });
      await probe(h);
      const states = h.sink.states().filter((s) => s.check.testPath === "test/mod.test.ts");
      expect(states.map((s) => [s.check.kind, s.validity, s.outcome])).toEqual([
        ["file", "current", "pass"],
        ["test", "current", "fail"],
      ]);
    },
  );
});

describe("two projects with config files of their own (review wave-13b B2)", () => {
  it("fail on the bytes on disk under a fresh adapter (the control)", SLOW, async () => {
    const repo = createRepo(TWO);
    expect(await freshOutcomes(repo.main, [A, B])).toEqual([
      ["a", "test/mod.test.ts", "fail"],
      ["b", "test/mod.test.ts", "fail"],
    ]);
  });

  it.each([true, false])(
    "store no server's transient transform as current (observe %s)",
    SLOW,
    async (observe) => {
      const repo = createRepo(TWO);
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        observe,
      });
      await probe(h);
      expect(stored(h)).toEqual([
        ["a", "test/mod.test.ts", "current", "fail"],
        ["b", "test/mod.test.ts", "current", "fail"],
      ]);
    },
  );

  // Review wave-13c S1: the transient transform is planted in the slow
  // instance's own cache, through its own closure walks: project A's on the
  // transient bytes, then B's on the restored ones, before the scheduler's
  // slow run uses that instance. A fresh slow instance would read the disk
  // and prove nothing.
  it.each([true, false])(
    "store no server's transient transform as current in the slow instance (observe %s)",
    SLOW,
    async (observe) => {
      const repo = createRepo(TWO);
      const { slotDir, ...options } = slowOptions(["test/mod.test.ts"]);
      const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
        ...options,
        observe,
      });
      const lanes = withSlowLanes(h, repo.main, slotDir, async (adapter) => {
        h.write("src/mod.ts", NEW);
        try {
          await adapter.closure(A);
        } finally {
          h.write("src/mod.ts", OLD);
        }
        await adapter.closure(B);
      });
      await h.scheduler.start();
      await h.scheduler.idle();

      expect(lanes.made()).toBeGreaterThan(0);
      expect(stored(h)).toEqual([
        ["a", "test/mod.test.ts", "current", "fail"],
        ["b", "test/mod.test.ts", "current", "fail"],
      ]);
    },
  );
});
