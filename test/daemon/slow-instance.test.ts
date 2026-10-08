import { describe, expect, it } from "vitest";
import { withSlowInstance } from "../../src/core/daemon/slow-instance.js";
import type {
  InvalidatedPath,
  RunnerAdapter,
  RunOptions,
  TestFileRef,
} from "../../src/core/types/index.js";

/*
 * Spec 004 D2 (task 004-18): a slow lane's runs go to an instance of their
 * own, made on the first of a pass and closed when the pass drains; every
 * other call goes to the fast instance.
 */

const FILE: TestFileRef = { project: "", path: "test/a.test.ts" };

function fake(name: string, log: string[]): RunnerAdapter {
  return {
    name: "vitest",
    adapterVersion: "1",
    async invalidate(paths: readonly InvalidatedPath[]) {
      log.push(`${name} invalidate ${paths.map((p) => p.path).join(",")}`);
      return { recreatedProjects: [] };
    },
    affected: async () => ({ direct: [], transitive: [] }),
    closure: async (testFile) => ({ testFile, paths: [] }),
    enumerate: async () => [],
    testFiles: async () => [FILE],
    environment: async () => [],
    async run(testFiles, options) {
      log.push(`${name} run ${options.lane ?? "-"}`);
      return {
        end: "completed",
        durationMs: 1,
        completedFiles: testFiles,
        results: [],
        fileErrors: [],
        failure: null,
      };
    },
    async close() {
      log.push(`${name} close`);
    },
  };
}

const options = (lane?: string): RunOptions => ({
  runId: "r",
  logDir: "/tmp/r",
  timeoutMs: null,
  ...(lane === undefined ? {} : { lane }),
});

const changed = (path: string): InvalidatedPath[] => [{ path, kind: "change" }];

describe("withSlowInstance (spec 004 D2, task 004-18)", () => {
  it("runs a slow lane in an instance of its own, made per pass, and the rest in the fast one", async () => {
    const log: string[] = [];
    let made = 0;
    const runner = withSlowInstance(fake("fast", log), () => fake(`slow${++made}`, log));
    await runner.run([FILE], options("vitest"));
    expect(made).toBe(0);
    await runner.run([FILE], options("slow:vitest"));
    await runner.invalidate(changed("src/a.ts"));
    await runner.run([FILE], options("slow:vitest"));
    await runner.releaseLane?.("vitest");
    await runner.releaseLane?.("slow:vitest");
    await runner.run([FILE], options("slow:vitest"));
    await runner.close();
    expect(log).toEqual([
      "fast run vitest",
      "slow1 run slow:vitest",
      // The slow instance gets the edit before its next run, not beside its run in flight.
      "fast invalidate src/a.ts",
      "slow1 invalidate src/a.ts",
      "slow1 run slow:vitest",
      "slow1 close",
      // A new pass, a fresh instance: it reads the disk as it is.
      "slow2 run slow:vitest",
      "fast close",
      "slow2 close",
    ]);
  });
});
