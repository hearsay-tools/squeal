import { describe, expect, it } from "vitest";
import { withSlowInstance } from "../../src/core/daemon/slow-instance.js";
import { SlowRelease } from "../../src/core/scheduler/slow-release.js";
import type {
  EpochMs,
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
  it("forwards a recheck to the fast instance only, and has none without one (007-26)", async () => {
    const log: string[] = [];
    expect(withSlowInstance(fake("fast", log), () => fake("slow", log)).recheck).toBeUndefined();

    const fast = {
      ...fake("fast", log),
      recheck: async () => {
        log.push("fast recheck");
        return { recreatedProjects: ["py"] };
      },
    };
    const runner = withSlowInstance(fast, () => fake("slow", log));
    await runner.run([FILE], options("slow:vitest"));
    expect(await runner.recheck?.()).toEqual({ recreatedProjects: ["py"] });
    expect(log).toEqual(["slow run slow:vitest", "fast recheck"]);
  });

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

  it.each([
    ["ends", null],
    ["fails, noted by the release and not thrown again", new Error("teardown failed")],
  ])(
    "a shutdown during the bound's close waits for its teardown, which runs once and %s (review 0.1.322, B4)",
    async (_, failure) => {
      const log: string[] = [];
      let entered = false;
      let open = () => {};
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      const slow = {
        ...fake("slow", log),
        async close() {
          entered = true;
          await gate;
          log.push("slow teardown");
          if (failure !== null) throw failure;
        },
      };
      const runner = withSlowInstance(fake("fast", log), () => slow);
      await runner.run([FILE], options("slow:vitest"));
      const ended = Date.now() as EpochMs;
      let closed = false;
      const noted: unknown[] = [];
      // The scheduler's `#releaseLane`: the runner's release, its error noted.
      const release = new SlowRelease(
        {
          release: (lane) =>
            runner.releaseLane?.(lane).catch((e: unknown) => void noted.push(e)) ??
            Promise.resolve(),
          lanes: () => [],
          endedAt: () => ended,
          now: () => Date.now() as EpochMs,
          closed: () => closed,
        },
        10,
      );
      release.opened("slow:vitest");
      release.arm();
      await expect.poll(() => entered).toBe(true);

      // The daemon's order: the scheduler's close, then the runner's.
      closed = true;
      release.close();
      let done = false;
      const shutdown = runner.close().then(() => {
        done = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(done).toBe(false);
      expect(log).not.toContain("slow teardown");

      open();
      await shutdown;
      expect(log.filter((line) => line === "slow teardown")).toHaveLength(1);
      expect(log.at(-1)).toBe("slow teardown");
      expect(noted).toEqual(failure === null ? [] : [failure]);
    },
  );

  it("a close that failed holds no later instance's: the daemon's close closes it once and resolves (row 011-228)", async () => {
    const log: string[] = [];
    const failure = new Error("teardown failed");
    let made = 0;
    const runner = withSlowInstance(fake("fast", log), () => {
      const slow = fake(`slow${++made}`, log);
      if (made > 1) return slow;
      return {
        ...slow,
        async close() {
          log.push("slow1 close");
          throw failure;
        },
      };
    });
    await runner.run([FILE], options("slow:vitest"));
    // The drained pass's release: its error goes to the scheduler, which notes it.
    await expect(runner.releaseLane?.("slow:vitest")).rejects.toBe(failure);
    await runner.run([FILE], options("slow:vitest"));

    await expect(runner.close()).resolves.toBeUndefined();
    expect(log).toEqual([
      "slow1 run slow:vitest",
      "slow1 close",
      "slow2 run slow:vitest",
      "fast close",
      "slow2 close",
    ]);
  });
});
