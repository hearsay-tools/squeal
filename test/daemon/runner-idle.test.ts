import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRecoveringRunner } from "../../src/core/daemon/runner.js";
import type {
  InvalidatedPath,
  RunnerAdapter,
  RunnerEnvironment,
  RunReport,
} from "../../src/core/types/runner.js";

/*
 * Spec 021 D20 (row 021-26): a recovering runner closes its adapter once no
 * call has started for `idleMs`. That planned close is not a crash (D7): no
 * failure note, and the next call creates a new adapter. The first
 * `invalidate` after reports what that adapter recreates for the batch, and
 * the projects whose environment moved, never every project, so unchanged
 * keys stay current and nothing reruns.
 */

const IDLE = 1_000;
const ref = { project: "unit", path: "a.test.ts" };
const edit: InvalidatedPath[] = [{ path: "src/a.ts", kind: "change" }];
const REPORT: RunReport = {
  end: "completed",
  durationMs: 1,
  completedFiles: [],
  results: [],
  fileErrors: [],
  failure: null,
};

/** Adapters over one config: `unit.config.ts` in a batch recreates `unit`. */
function fakes(
  run: () => Promise<RunReport> = async () => REPORT,
  teardown: () => Promise<void> = async () => {},
) {
  const made: number[] = [];
  const closed: number[] = [];
  const config = { unit: "{}", e2e: "{}" };
  const environment = (project: "unit" | "e2e", resolvedConfig: string): RunnerEnvironment => ({
    project,
    runnerName: "node-test",
    runnerVersion: "26",
    adapterVersion: "1",
    resolvedConfig,
    files: [],
  });
  const create = async (): Promise<RunnerAdapter> => {
    const n = made.length + 1;
    made.push(n);
    const values = { ...config };
    return {
      name: "node-test",
      adapterVersion: "1",
      invalidate: async (paths) => ({
        recreatedProjects: paths.some((p) => p.path === "unit.config.ts") ? ["unit"] : [],
      }),
      affected: async () => ({ direct: [], transitive: [] }),
      closure: async (testFile) => ({ testFile, paths: [`made-${n}`] }),
      enumerate: async () => [],
      testFiles: async () => [],
      environment: async () => [environment("unit", values.unit), environment("e2e", values.e2e)],
      run,
      slowWidth: () => 10 * n,
      close: async () => {
        closed.push(n);
        await teardown();
      },
    };
  };
  return { made, closed, config, create };
}

/** `idleMs` `null`: the option is absent. */
function runner(f: ReturnType<typeof fakes>, idleMs: (() => number) | null = () => IDLE) {
  const failures: string[] = [];
  const recovered: string[] = [];
  const adapter = createRecoveringRunner({
    name: "node-test",
    adapterVersion: "1",
    create: f.create,
    onFailure: (text) => failures.push(text),
    onRecovered: () => recovered.push("recovered"),
    ...(idleMs === null ? {} : { idleMs }),
  });
  return { adapter, notes: () => [...failures, ...recovered] };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("recovering runner: an idle adapter closes (spec 021 D20)", () => {
  it("closes the adapter once no call started for the idle time, and the next call makes another", async () => {
    const f = fakes();
    const { adapter, notes } = runner(f);
    await adapter.closure(ref);
    vi.advanceTimersByTime(IDLE - 1);
    expect(f.closed).toEqual([]);
    // A call restarts the time.
    await adapter.closure(ref);
    vi.advanceTimersByTime(IDLE - 1);
    expect(f.closed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(f.closed).toEqual([1]);
    expect((await adapter.closure(ref)).paths).toEqual(["made-2"]);
    expect(f.made).toEqual([1, 2]);
    expect(notes()).toEqual([]);
  });

  it("never closes an adapter while a call is in flight", async () => {
    let release = () => {};
    const f = fakes(
      () =>
        new Promise<RunReport>((resolve) => {
          release = () => resolve(REPORT);
        }),
    );
    const { adapter } = runner(f);
    const run = adapter.run([ref], { runId: "r", logDir: "/tmp/l", timeoutMs: null });
    await vi.advanceTimersByTimeAsync(10 * IDLE);
    expect(f.closed).toEqual([]);
    release();
    await run;
    vi.advanceTimersByTime(IDLE - 1);
    expect(f.closed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(f.closed).toEqual([1]);
  });

  it("reports nothing recreated at the first edit after a close, with no note", async () => {
    const f = fakes();
    const { adapter, notes } = runner(f);
    expect(await adapter.environment()).toHaveLength(2);
    expect(await adapter.invalidate(edit)).toEqual({ recreatedProjects: [] });
    vi.advanceTimersByTime(IDLE);
    expect(f.closed).toEqual([1]);
    expect(await adapter.invalidate(edit)).toEqual({ recreatedProjects: [] });
    expect(f.made).toEqual([1, 2]);
    expect(notes()).toEqual([]);
  });

  it("recreates only the project whose config changed while closed", async () => {
    const f = fakes();
    const { adapter } = runner(f);
    await adapter.environment();
    vi.advanceTimersByTime(IDLE);
    expect(f.closed).toEqual([1]);
    f.config.unit = '{"changed":true}';
    const batch: InvalidatedPath[] = [{ path: "unit.config.ts", kind: "change" }];
    expect(await adapter.invalidate(batch)).toEqual({ recreatedProjects: ["unit"] });
    // Reported once: the next batch is the new adapter's own.
    expect(await adapter.invalidate(edit)).toEqual({ recreatedProjects: [] });
  });

  it("recreates a project whose environment moved while closed, with no file of it in the batch", async () => {
    const f = fakes();
    const { adapter } = runner(f);
    await adapter.environment();
    vi.advanceTimersByTime(IDLE);
    f.config.e2e = '{"python":"3.13"}';
    expect(await adapter.invalidate(edit)).toEqual({ recreatedProjects: ["e2e"] });
  });

  it("compares with the environment the closed adapter answered, when another call reopened first", async () => {
    const f = fakes();
    const { adapter } = runner(f);
    await adapter.environment();
    vi.advanceTimersByTime(IDLE);
    f.config.e2e = '{"moved":1}';
    await adapter.run([ref], { runId: "r", logDir: "/tmp/l", timeoutMs: null });
    expect(f.made).toEqual([1, 2]);
    expect(await adapter.invalidate(edit)).toEqual({ recreatedProjects: ["e2e"] });
  });

  it("recreates every project when the batch changed squeal.config.json, as a live adapter compares the policy", async () => {
    const f = fakes();
    const { adapter } = runner(f);
    await adapter.environment();
    vi.advanceTimersByTime(IDLE);
    const batch: InvalidatedPath[] = [{ path: "squeal.config.json", kind: "change" }];
    expect(await adapter.invalidate(batch)).toEqual({ recreatedProjects: ["e2e", "unit"] });
  });

  it("never closes at 0 or without the option", async () => {
    for (const idleMs of [() => 0, null]) {
      const f = fakes();
      const { adapter } = runner(f, idleMs);
      await adapter.closure(ref);
      vi.advanceTimersByTime(24 * 3_600_000);
      expect(f.closed).toEqual([]);
      await adapter.close();
      expect(f.closed).toEqual([1]);
    }
  });

  it("is held by a recheck only while it runs, and a recheck neither restarts the time nor reopens", async () => {
    const f = fakes();
    const { adapter } = runner(f);
    await adapter.closure(ref);
    vi.advanceTimersByTime(IDLE / 2);
    await adapter.recheck?.();
    vi.advanceTimersByTime(IDLE / 2);
    expect(f.closed).toEqual([1]);
    expect(await adapter.recheck?.()).toEqual({ recreatedProjects: [] });
    expect(f.made).toEqual([1]);
  });

  it("answers the synchronous members from the closed adapter until another exists", async () => {
    const f = fakes();
    const { adapter } = runner(f);
    expect(adapter.slowWidth?.([ref])).toBe(1);
    await adapter.closure(ref);
    expect(adapter.slowWidth?.([ref])).toBe(10);
    vi.advanceTimersByTime(IDLE);
    expect(f.closed).toEqual([1]);
    expect(adapter.slowWidth?.([ref])).toBe(10);
    await adapter.closure(ref);
    expect(adapter.slowWidth?.([ref])).toBe(20);
  });

  it("makes the next adapter only once the idle adapter's close has ended (review 0.1.461 B1)", async () => {
    let release = () => {};
    const f = fakes(
      async () => REPORT,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { adapter } = runner(f);
    await adapter.closure(ref);
    await vi.advanceTimersByTimeAsync(IDLE);
    // The idle close runs its teardown; a call now must not start a second host beside it.
    const next = adapter.closure(ref);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.made).toEqual([1]);
    release();
    expect((await next).paths).toEqual(["made-2"]);
    expect(f.closed[0]).toBe(1);
  });

  it("returns from close only once the idle adapter's close has ended (review 0.1.461 B1)", async () => {
    let release = () => {};
    const f = fakes(
      async () => REPORT,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { adapter } = runner(f);
    await adapter.closure(ref);
    await vi.advanceTimersByTimeAsync(IDLE);
    let done = false;
    const closing = adapter.close().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    release();
    await closing;
    expect(f.closed).toEqual([1]);
  });

  it("starts one adapter for callers that wait on the same close, and none once closed meanwhile (review 0.1.461 B1)", async () => {
    let release = () => {};
    const f = fakes(
      async () => REPORT,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { adapter } = runner(f);
    await adapter.closure(ref);
    await vi.advanceTimersByTimeAsync(IDLE);
    const both = Promise.all([adapter.closure(ref), adapter.closure(ref)]);
    await vi.advanceTimersByTimeAsync(0);
    release();
    expect((await both).map((c) => c.paths)).toEqual([["made-2"], ["made-2"]]);
    expect(f.made).toEqual([1, 2]);

    // A close while a reopen waits on the old close starts no adapter.
    await vi.advanceTimersByTimeAsync(IDLE);
    const queued = adapter.closure(ref);
    await vi.advanceTimersByTimeAsync(0);
    const closing = adapter.close();
    release();
    await closing;
    await expect(queued).rejects.toThrow("adapter: closed");
    expect(f.made).toEqual([1, 2]);
  });
});
