import { describe, expect, it } from "vitest";
import { createRecoveringRunner } from "../../src/core/daemon/runner.js";
import type { RunnerAdapter, RunnerEnvironment } from "../../src/core/types/index.js";

function fakeAdapter(log: string[]): RunnerAdapter {
  const environment: RunnerEnvironment = {
    project: "unit",
    runnerName: "vitest",
    runnerVersion: "5",
    adapterVersion: "2",
    resolvedConfig: "{}",
    files: [],
  };
  return {
    name: "vitest",
    adapterVersion: "2",
    invalidate: async () => {
      log.push("invalidate");
      return { recreatedProjects: [] };
    },
    affected: async () => ({ direct: [{ project: "unit", path: "a.test.ts" }], transitive: [] }),
    closure: async (testFile) => ({ testFile, paths: [testFile.path] }),
    enumerate: async () => [],
    testFiles: async () => {
      log.push("testFiles");
      return [{ project: "unit", path: "a.test.ts" }];
    },
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
      log.push("close");
    },
  };
}

/** A factory that fails while `errors` has entries, then builds a fake adapter. */
function factory(errors: string[]) {
  const log: string[] = [];
  let attempts = 0;
  return {
    log,
    attempts: () => attempts,
    create: async () => {
      attempts++;
      const error = errors.shift();
      if (error !== undefined) throw new Error(error);
      return fakeAdapter(log);
    },
  };
}

function runner(f: ReturnType<typeof factory>) {
  const failures: string[] = [];
  const recovered: number[] = [];
  const adapter = createRecoveringRunner({
    name: "vitest",
    adapterVersion: "2",
    create: f.create,
    onFailure: (message) => failures.push(message),
    onRecovered: () => recovered.push(1),
  });
  return { adapter, failures, recovered };
}

const change = [{ path: "vitest.config.ts", kind: "change" as const }];

describe("recovering runner: a broken config is a state, never an exit (review B1 input 6)", () => {
  it("opens the adapter and delegates every call when creation works", async () => {
    const f = factory([]);
    const { adapter, failures } = runner(f);
    expect(await adapter.open()).toBe(true);
    expect(await adapter.testFiles()).toEqual([{ project: "unit", path: "a.test.ts" }]);
    expect(await adapter.invalidate(change)).toEqual({ recreatedProjects: [] });
    expect(f.log).toEqual(["testFiles", "invalidate"]);
    expect(f.attempts()).toBe(1);
    expect(failures).toEqual([]);
  });

  it("rejects every call with the creation error and reports it once, without retrying", async () => {
    const f = factory(["vitest.config.ts: Unexpected token"]);
    const { adapter, failures } = runner(f);
    expect(await adapter.open()).toBe(false);
    for (const call of [
      () => adapter.testFiles(),
      () => adapter.environment(),
      () => adapter.affected(["a.ts"]),
      () => adapter.closure({ project: "", path: "a.test.ts" }),
      () => adapter.enumerate({ project: "", path: "a.test.ts" }),
      () => adapter.run([], { runId: "r", logDir: "/tmp/r", timeoutMs: null }),
    ]) {
      await expect(call()).rejects.toThrow(
        "vitest could not start: vitest.config.ts: Unexpected token",
      );
    }
    expect(f.attempts()).toBe(1);
    expect(failures).toEqual(["vitest could not start: vitest.config.ts: Unexpected token"]);
  });

  it("forwards affected with its direct and transitive split (spec 001 D5 step 4)", async () => {
    expect(await runner(factory([])).adapter.affected(["a.ts"])).toEqual({
      direct: [{ project: "unit", path: "a.test.ts" }],
      transitive: [],
    });
  });

  it("retries on the next batch and reports a recreate of every project when it works", async () => {
    const f = factory(["broken"]);
    const { adapter, recovered } = runner(f);
    await adapter.open();
    expect(await adapter.invalidate(change)).toEqual({ recreatedProjects: ["e2e", "unit"] });
    expect(f.attempts()).toBe(2);
    expect(recovered).toEqual([1]);
    // The fresh instance has nothing cached, so nothing reached its invalidate.
    expect(f.log).toEqual([]);
    expect(await adapter.testFiles()).toHaveLength(1);
    await adapter.invalidate(change);
    expect(f.log).toEqual(["testFiles", "invalidate"]);
    expect(f.attempts()).toBe(2);
  });

  it("strips colour codes from the error, since notes are plain text", async () => {
    const f = factory(["\u001b[31m[PARSE_ERROR] \u001b[0mUnexpected token\n"]);
    const { adapter, failures } = runner(f);
    await adapter.open();
    expect(failures).toEqual(["vitest could not start: [PARSE_ERROR] Unexpected token"]);
  });

  it("reports a changed error, not the same one twice", async () => {
    const f = factory(["broken", "broken", "still broken"]);
    const { adapter, failures } = runner(f);
    await adapter.open();
    await expect(adapter.invalidate(change)).rejects.toThrow("broken");
    await expect(adapter.invalidate(change)).rejects.toThrow("still broken");
    expect(f.attempts()).toBe(3);
    expect(failures).toEqual([
      "vitest could not start: broken",
      "vitest could not start: still broken",
    ]);
  });

  it("retry() makes the next call try again, for run --all", async () => {
    const f = factory(["broken"]);
    const { adapter } = runner(f);
    await adapter.open();
    await expect(adapter.environment()).rejects.toThrow("broken");
    adapter.retry();
    expect((await adapter.environment()).map((e) => e.project)).toEqual(["unit", "e2e"]);
    expect(f.attempts()).toBe(2);
  });

  it("shares one attempt between concurrent calls", async () => {
    const f = factory(["broken"]);
    const { adapter } = runner(f);
    await adapter.open();
    adapter.retry();
    const [a, b] = await Promise.all([adapter.testFiles(), adapter.environment()]);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);
    expect(f.attempts()).toBe(2);
  });

  it("closes the adapter it created and rejects calls afterwards", async () => {
    const f = factory([]);
    const { adapter } = runner(f);
    await adapter.open();
    await adapter.close();
    expect(f.log).toEqual(["close"]);
    await expect(adapter.testFiles()).rejects.toThrow("closed");
  });
});
