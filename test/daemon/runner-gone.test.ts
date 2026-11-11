import { describe, expect, it } from "vitest";
import { createRecoveringRunner } from "../../src/core/daemon/runner.js";
import type { RunnerAdapter, RunnerEnvironment } from "../../src/core/types/runner.js";

/*
 * Spec 021 D7 (row 021-11): a runner host that exits, or misses a deadline,
 * is gone. The recovering runner drops it, the next call starts a new one,
 * and the next `invalidate` reports every project recreated, so the keys are
 * read again from the new instance. A failed start keeps the could-not-start
 * note of a broken config.
 */

interface Fake extends RunnerAdapter {
  dead: boolean;
  readonly n: number;
}

function fakes(errors: (string | null)[] = []) {
  const made: Fake[] = [];
  const closed: number[] = [];
  const environment: RunnerEnvironment = {
    project: "unit",
    runnerName: "vitest",
    runnerVersion: "5",
    adapterVersion: "2",
    resolvedConfig: "{}",
    files: [],
  };
  const create = async (): Promise<RunnerAdapter> => {
    const error = errors.shift();
    if (error !== undefined && error !== null) throw new Error(error);
    const n = made.length + 1;
    const fake: Fake = {
      n,
      dead: false,
      name: "vitest",
      adapterVersion: "2",
      invalidate: async () => ({ recreatedProjects: [] }),
      affected: async () => ({ direct: [], transitive: [] }),
      closure: async (testFile) => ({ testFile, paths: [`made-${n}`] }),
      enumerate: async () => [],
      testFiles: async () => [],
      environment: async () => [environment, { ...environment, project: "e2e" }],
      run: async () => ({
        end: "completed",
        durationMs: 1,
        completedFiles: [],
        results: [],
        fileErrors: [],
        failure: null,
      }),
      close: async () => {
        closed.push(n);
      },
    };
    made.push(fake);
    return fake;
  };
  return { made, closed, create };
}

const ref = { project: "unit", path: "a.test.ts" };
const change = [{ path: "src/a.ts", kind: "change" as const }];

function runner(f: ReturnType<typeof fakes>) {
  const failures: string[] = [];
  const adapter = createRecoveringRunner({
    name: "vitest",
    adapterVersion: "2",
    create: f.create,
    onFailure: (text) => failures.push(text),
    gone: (inner) => (inner as Fake).dead,
  });
  return { adapter, failures };
}

describe("recovering runner: a gone adapter is replaced (spec 021 D7)", () => {
  it("drops a gone adapter, closes it, and builds a new one at the next call", async () => {
    const f = fakes();
    const { adapter } = runner(f);
    expect((await adapter.closure(ref)).paths).toEqual(["made-1"]);
    const first = f.made[0];
    if (first === undefined) throw new Error("no adapter made");
    first.dead = true;
    expect((await adapter.closure(ref)).paths).toEqual(["made-2"]);
    expect(f.closed).toEqual([1]);
    expect((await adapter.closure(ref)).paths).toEqual(["made-2"]);
    expect(f.made).toHaveLength(2);
  });

  it("reports every project recreated at the first invalidate after a drop, once", async () => {
    const f = fakes();
    const { adapter } = runner(f);
    expect(await adapter.open()).toBe(true);
    expect(await adapter.invalidate(change)).toEqual({ recreatedProjects: [] });
    const first = f.made[0];
    if (first === undefined) throw new Error("no adapter made");
    first.dead = true;
    // Another call builds the new adapter first; the invalidate after it still re-keys.
    expect((await adapter.closure(ref)).paths).toEqual(["made-2"]);
    expect(await adapter.invalidate(change)).toEqual({ recreatedProjects: ["e2e", "unit"] });
    expect(await adapter.invalidate(change)).toEqual({ recreatedProjects: [] });
  });

  it("notes a failed start after a drop as a broken config, and the next batch retries", async () => {
    const f = fakes([null, "vitest/node does not resolve"]);
    const { adapter, failures } = runner(f);
    expect(await adapter.open()).toBe(true);
    const first = f.made[0];
    if (first === undefined) throw new Error("no adapter made");
    first.dead = true;
    await expect(adapter.closure(ref)).rejects.toThrow(
      "vitest could not start: vitest/node does not resolve",
    );
    expect(failures).toEqual(["vitest could not start: vitest/node does not resolve"]);
    expect(await adapter.invalidate(change)).toEqual({ recreatedProjects: ["e2e", "unit"] });
    expect(f.made).toHaveLength(2);
  });

  it("keeps an adapter that is not gone, without the option too", async () => {
    const f = fakes();
    const plain = createRecoveringRunner({
      name: "vitest",
      adapterVersion: "2",
      create: f.create,
      onFailure: () => {},
    });
    await plain.closure(ref);
    const first = f.made[0];
    if (first === undefined) throw new Error("no adapter made");
    first.dead = true;
    expect((await plain.closure(ref)).paths).toEqual(["made-1"]);
  });
});
