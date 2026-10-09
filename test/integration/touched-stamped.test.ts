import { describe, expect, it } from "vitest";
import type { RunnerAdapter } from "../../src/core/types/index.js";
import { type Harness, openHarness, openRepoStore, SLOW } from "../scheduler/helpers.js";
import {
  BASE,
  createRepo,
  NEW,
  OLD,
  readsNew,
  slowOptions,
  stored,
  withheldByBarrier,
  withSlowLanes,
} from "./stamps-repo.js";
import { probeTouched, touchHeard, warmOn } from "./touched-repo.js";

/*
 * Task 001-159: the probes of reviews wave-13, wave-13b and wave-13c, which
 * the per-module stamps catch (001-151, 001-154, 001-157), now followed by
 * the touch the watcher sees of the restore. The instance is discarded as
 * well; what is stored as current is still what the restored bytes give.
 * The fresh-adapter controls are in `project-config-stamps.test.ts` and
 * `query-stamps.test.ts`.
 */

const config = (body: string) =>
  `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: ${body} });\n`;
const project = (name: string) => config(`{ name: "${name}", include: ["test/*.test.ts"] }`);

const ONE: Readonly<Record<string, string>> = {
  ...BASE,
  "vitest.config.ts": config('{ projects: ["./vitest.unit.config.ts"] }'),
  "vitest.unit.config.ts": project("unit"),
  "test/mod.test.ts": readsNew("../src/mod.ts"),
};
const TWO: Readonly<Record<string, string>> = {
  ...BASE,
  "vitest.config.ts": config('{ projects: ["./vitest.a.config.ts", "./vitest.b.config.ts"] }'),
  "vitest.a.config.ts": project("a"),
  "vitest.b.config.ts": project("b"),
  "test/mod.test.ts": readsNew("../src/mod.ts"),
};
const PAIR: Readonly<Record<string, string>> = {
  ...BASE,
  "test/variant.test.ts": readsNew("../src/mod.ts?variant"),
  "test/plain.test.ts": readsNew("../src/mod.ts"),
};

const MOD = (project: string) => ({ project, path: "test/mod.test.ts" });
const VARIANT = { project: "", path: "test/variant.test.ts" };
const PLAIN = { project: "", path: "test/plain.test.ts" };

const open = (files: Readonly<Record<string, string>>, observe: boolean) => {
  const repo = createRepo(files);
  return openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
    observe,
    runnerPartBesideRun: true,
  });
};

/** Closure walks of `projects` on transient bytes, the first while they are on disk. */
async function walk(h: Harness, adapter: RunnerAdapter, ...projects: string[]) {
  const [first, ...rest] = projects;
  h.write("src/mod.ts", NEW);
  try {
    if (first !== undefined) await adapter.closure(MOD(first));
  } finally {
    h.write("src/mod.ts", OLD);
  }
  for (const name of rest) await adapter.closure(MOD(name));
}

/** The variant runs on transient bytes, the plain module after the restore (review wave-13c B1). */
const variantThenPlain = async (h: Harness, adapter: RunnerAdapter) => {
  await warmOn(h, adapter, [VARIANT], "src/mod.ts", NEW, OLD);
  await adapter.run([PLAIN], { runId: "plain", logDir: `${h.root}/.squeal-logs`, timeoutMs: null });
};

describe.each([true, false])("a touched restore after a stamped probe (observe %s)", (observe) => {
  it("a project with its own config file (review wave-13 B2)", SLOW, async () => {
    const h = await open(ONE, observe);
    await probeTouched(h, (adapter) => walk(h, adapter, "unit"), ["src/mod.ts"]);
    expect(stored(h)).toEqual([["unit", "test/mod.test.ts", "current", "fail"]]);
  });

  it("two projects with config files of their own (review wave-13b B2)", SLOW, async () => {
    const h = await open(TWO, observe);
    await probeTouched(h, (adapter) => walk(h, adapter, "a", "b"), ["src/mod.ts"]);
    expect(stored(h)).toEqual([
      ["a", "test/mod.test.ts", "current", "fail"],
      ["b", "test/mod.test.ts", "current", "fail"],
    ]);
  });

  it("a query variant beside the plain module (review wave-13c B1)", SLOW, async () => {
    const h = await open(PAIR, observe);
    await probeTouched(h, (adapter) => variantThenPlain(h, adapter), ["src/mod.ts"]);
    expect(stored(h)).toEqual([
      ["", "test/plain.test.ts", "current", "fail"],
      ["", "test/variant.test.ts", "current", "fail"],
    ]);
  });

  // Spec 004 D2: planted in the slow instance's own cache before its first run, which waits
  // until the touch reached it.
  it("the slow instance's own cache (review wave-13c S1)", SLOW, async () => {
    const repo = createRepo(PAIR);
    const { slotDir, ...options } = slowOptions(["test/variant.test.ts", "test/plain.test.ts"]);
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
      ...options,
      observe,
      runnerPartBesideRun: true,
    });
    let heard: Promise<void> | null = null;
    const lanes = withSlowLanes(h, repo.main, slotDir, async (adapter) => {
      await variantThenPlain(h, adapter);
      await h.batch("src/mod.ts");
      await heard;
    });
    heard = touchHeard(h);
    await h.scheduler.start();
    await h.scheduler.idle();

    // The slow instance is made, and planted, after its tier was selected: the touch is over the
    // run's interval, so the completion barrier withholds it (task 001-168).
    expect(lanes.made()).toBeGreaterThan(0);
    expect(stored(h)).toEqual([]);
    withheldByBarrier(h, "test/variant.test.ts");
  });
});
