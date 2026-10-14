import { describe, expect, it } from "vitest";
import type { InvalidateResult, RunnerAdapter } from "../../src/core/types/index.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Task 007-26 (007 review wave 2.5, R2): a reconciliation pass that applied
 * and touched nothing asks the runner's `recheck` and nothing else, so an
 * adapter looks at what no watched file shows, a pytest environment's
 * installed set, without any other runner work. A project it reports
 * recreated re-reads the environments and re-keys, as a recreate from a
 * changed path does.
 */

/** The runner calls a pass may make, besides `run` and `enumerate`. */
const CALLS = ["invalidate", "affected", "closure", "testFiles", "environment"] as const;

async function open(
  recheck: () => Promise<InvalidateResult> = async () => ({ recreatedProjects: [] }),
): Promise<{ h: Harness; calls: string[] }> {
  const repo = createRepo();
  const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir);
  await h.scheduler.start();
  await h.scheduler.idle();
  const calls: string[] = [];
  const runner: RunnerAdapter = h.runner;
  for (const name of CALLS) {
    const call = runner[name] as (...args: unknown[]) => Promise<unknown>;
    Object.assign(runner, {
      [name]: (...args: unknown[]) => {
        calls.push(name);
        return call(...args);
      },
    });
  }
  h.runner.recheck = () => {
    calls.push("recheck");
    return recheck();
  };
  return { h, calls };
}

const latest = (h: Harness) => h.store.revisions.latest(h.worktreeId)?.number ?? 0;
const interval = (h: Harness) => h.scheduler.handleBatch({ trigger: "interval", paths: [] });

describe("scheduler: the recheck at a quiet reconciliation pass (007-26)", () => {
  it(
    "calls recheck once per pass and nothing else of a real Vitest adapter, with no revision",
    SLOW,
    async () => {
      const { h, calls } = await open();
      const revision = latest(h);
      const runs = h.runner.runs.length;
      await interval(h);
      await h.scheduler.idle();
      await interval(h);
      await h.scheduler.idle();

      // R2: no `affected([])`, whose Vitest answer globs the suite's specifications again.
      expect(calls).toEqual(["recheck", "recheck"]);
      expect(latest(h)).toBe(revision);
      expect(h.runner.runs.length).toBe(runs);
    },
  );

  it("a watch batch with nothing changed does not recheck", SLOW, async () => {
    const { h, calls } = await open();
    await h.scheduler.handleBatch({ trigger: "watch", paths: [] });
    await h.scheduler.idle();

    expect(calls).toEqual([]);
  });

  it(
    "re-reads the environments and re-keys a project the recheck recreated, as invalidate's",
    SLOW,
    async () => {
      const { h, calls } = await open(async () => ({ recreatedProjects: [""] }));
      const before = h.keyOf("test/math.test.ts");
      const runs = h.runsOf("test/math.test.ts").length;
      const environment = h.runner.environment;
      h.runner.environment = async () =>
        (await environment()).map((e) => ({
          ...e,
          resolvedConfig: `${e.resolvedConfig}+upgraded`,
        }));
      await interval(h);
      await h.scheduler.idle();

      expect(h.keyOf("test/math.test.ts")).not.toEqual(before);
      expect(h.runsOf("test/math.test.ts").length).toBe(runs + 1);
      // The recheck stood for invalidate; the recreate's refinement did the rest.
      expect(calls.slice(0, 2)).toEqual(["recheck", "environment"]);
      expect(calls).not.toContain("invalidate");
    },
  );

  it("a recheck that fails is a note, and the checks stay as they were", SLOW, async () => {
    const { h, calls } = await open(async () => {
      throw new Error("fingerprint unreadable");
    });
    const before = h.keyOf("test/math.test.ts");
    await interval(h);
    await h.scheduler.idle();

    expect(calls).toEqual(["recheck"]);
    expect(h.keyOf("test/math.test.ts")).toEqual(before);
    expect(h.header().counts).toMatchObject({ pending: 0, stale: 0, unknown: 0 });
  });
});
