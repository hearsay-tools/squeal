import { describe, expect, it } from "vitest";
import type { InvalidatedPath } from "../../src/core/types/index.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * 007 review wave 2, B1 (agreed with the coordinator): a reconciliation pass
 * that changed nothing still reaches the runner, as an empty `invalidate`,
 * so an adapter rechecks what no watched file shows, a pytest environment's
 * installed set. A project it reports recreated re-reads the environments
 * and re-keys, as a recreate from a changed path does.
 */

async function open(): Promise<{ h: Harness; calls: InvalidatedPath[][] }> {
  const repo = createRepo();
  const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir);
  await h.scheduler.start();
  await h.scheduler.idle();
  const calls: InvalidatedPath[][] = [];
  const invalidate = h.runner.invalidate;
  h.runner.invalidate = (paths) => {
    calls.push([...paths]);
    return invalidate(paths);
  };
  return { h, calls };
}

const latest = (h: Harness) => h.store.revisions.latest(h.worktreeId)?.number ?? 0;
const interval = (h: Harness) => h.scheduler.handleBatch({ trigger: "interval", paths: [] });

describe("scheduler: the environment recheck at each reconciliation pass (007 B1)", () => {
  it(
    "calls invalidate([]) once per pass with nothing changed, and makes no revision",
    SLOW,
    async () => {
      const { h, calls } = await open();
      const revision = latest(h);
      const runs = h.runner.runs.length;
      await interval(h);
      await h.scheduler.idle();

      expect(calls).toEqual([[]]);
      expect(latest(h)).toBe(revision);
      expect(h.runner.runs.length).toBe(runs);
    },
  );

  it(
    "costs a real Vitest adapter nothing: no recreate, no listing, no environment",
    SLOW,
    async () => {
      const { h } = await open();
      const results: unknown[] = [];
      const invalidate = h.runner.invalidate;
      h.runner.invalidate = async (paths) => {
        const result = await invalidate(paths);
        results.push(result);
        return result;
      };
      const calls: string[] = [];
      const { testFiles, environment } = h.runner;
      h.runner.testFiles = () => {
        calls.push("testFiles");
        return testFiles();
      };
      h.runner.environment = () => {
        calls.push("environment");
        return environment();
      };
      await interval(h);
      await h.scheduler.idle();

      expect(results).toEqual([{ recreatedProjects: [] }]);
      expect(calls).toEqual([]);
    },
  );

  it("a watch batch with nothing changed does not recheck", SLOW, async () => {
    const { h, calls } = await open();
    await h.scheduler.handleBatch({ trigger: "watch", paths: [] });
    await h.scheduler.idle();

    expect(calls).toEqual([]);
  });

  it("re-reads the environments and re-keys a project the recheck recreated", SLOW, async () => {
    const { h } = await open();
    const before = h.keyOf("test/math.test.ts");
    const runs = h.runsOf("test/math.test.ts").length;
    const invalidate = h.runner.invalidate;
    h.runner.invalidate = async (paths) =>
      paths.length === 0 ? { recreatedProjects: [""] } : invalidate(paths);
    const environment = h.runner.environment;
    h.runner.environment = async () =>
      (await environment()).map((e) => ({ ...e, resolvedConfig: `${e.resolvedConfig}+upgraded` }));
    await interval(h);
    await h.scheduler.idle();

    expect(h.keyOf("test/math.test.ts")).not.toEqual(before);
    expect(h.runsOf("test/math.test.ts").length).toBe(runs + 1);
  });
});
