import { describe, expect, it } from "vitest";
import {
  laneInstanceWorkers,
  vitestLaneGroup,
  withSlowInstance,
} from "../../src/core/daemon/slow-instance.js";
import { SlowRelease } from "../../src/core/scheduler/slow-release.js";
import type { CheckGroup } from "../../src/core/types/check-groups.js";
import type { EpochMs } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import type { InvalidatedPath, RunnerAdapter, RunOptions } from "../../src/core/types/runner.js";
import { NO_TRAITS } from "../../src/core/types/runner-traits.js";

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
    traits: NO_TRAITS,
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

  it("runs a beside lane in a third instance of its own, closed by its release alone; the slow one is untouched (row 011-269)", async () => {
    const log: string[] = [];
    let made = 0;
    const runner = withSlowInstance(
      fake("fast", log),
      () => fake("slow", log),
      () => fake(`beside${++made}`, log),
    );
    await runner.run([FILE], options("vitest"));
    expect(made).toBe(0);
    await runner.run([FILE], options("beside:vitest"));
    await runner.run([FILE], options("slow:vitest"));
    await runner.invalidate(changed("src/a.ts"));
    await runner.run([FILE], options("beside:vitest"));
    await runner.releaseLane?.("beside:vitest");
    await runner.run([FILE], options("slow:vitest"));
    await runner.run([FILE], options("beside:vitest"));
    await runner.close();
    expect(log).toEqual([
      "fast run vitest",
      "beside1 run beside:vitest",
      "slow run slow:vitest",
      // Each second instance gets the edit before its own next run.
      "fast invalidate src/a.ts",
      "beside1 invalidate src/a.ts",
      "beside1 run beside:vitest",
      "beside1 close",
      // The beside lane's release left the slow instance open.
      "slow invalidate src/a.ts",
      "slow run slow:vitest",
      "beside2 run beside:vitest",
      "fast close",
      "slow close",
      "beside2 close",
    ]);
  });

  it("runs a beside lane in the fast instance when no beside instance is given (row 011-269)", async () => {
    const log: string[] = [];
    const runner = withSlowInstance(fake("fast", log), () => fake("slow", log));
    await runner.run([FILE], options("beside:vitest"));
    await runner.releaseLane?.("beside:vitest");
    expect(log).toEqual(["fast run beside:vitest"]);
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

describe("an instance per group lane (spec 019 D3, row 019-12)", () => {
  /** A lane's instances, named `<lane>#<n>` in the order `createLane` made them. */
  function laned(log: string[]) {
    const made = new Map<string, number>();
    const runner = withSlowInstance(fake("fast", log), (lane) => {
      made.set(lane, (made.get(lane) ?? 0) + 1);
      return fake(`${lane}#${made.get(lane)}`, log);
    });
    return { runner, made };
  }

  it("runs each group lane in an instance of its own, made on its first run and closed by its own release alone", async () => {
    const log: string[] = [];
    const { runner, made } = laned(log);
    await runner.run([FILE], options("vitest"));
    await runner.run([FILE], options("group:e2e:vitest"));
    await runner.run([FILE], options("group:api:vitest"));
    await runner.run([FILE], options("slow:vitest"));
    await runner.run([FILE], options("group:e2e:vitest"));
    await runner.invalidate(changed("src/a.ts"));
    await runner.releaseLane?.("group:e2e:vitest");
    // Another runner's group lane, and a lane never run: no instance of these closes.
    await runner.releaseLane?.("slow:node-test");
    await runner.releaseLane?.("group:other:vitest");
    await runner.run([FILE], options("group:e2e:vitest"));
    await runner.run([FILE], options("group:api:vitest"));
    await runner.close();
    expect(Object.fromEntries(made)).toEqual({
      "group:e2e:vitest": 2,
      "group:api:vitest": 1,
      "slow:vitest": 1,
    });
    expect(log).toEqual([
      "fast run vitest",
      "group:e2e:vitest#1 run group:e2e:vitest",
      "group:api:vitest#1 run group:api:vitest",
      "slow:vitest#1 run slow:vitest",
      // One instance per lane: the lane's second run goes to the one its first made.
      "group:e2e:vitest#1 run group:e2e:vitest",
      "fast invalidate src/a.ts",
      "group:e2e:vitest#1 close",
      // A new pass of the lane, a fresh instance: it reads the disk as it is.
      "group:e2e:vitest#2 run group:e2e:vitest",
      // The other lanes' instances stayed open and get the edit before their next run.
      "group:api:vitest#1 invalidate src/a.ts",
      "group:api:vitest#1 run group:api:vitest",
      "fast close",
      "group:e2e:vitest#2 close",
      "group:api:vitest#1 close",
      "slow:vitest#1 close",
    ]);
  });

  it("closes each open lane's instance once its bound passed with no tier, and makes a new one on the next run (row 011-211)", async () => {
    const log: string[] = [];
    const { runner } = laned(log);
    await runner.run([FILE], options("slow:vitest"));
    await runner.run([FILE], options("group:e2e:vitest"));
    const ended = Date.now() as EpochMs;
    // The scheduler's `SlowRelease`, its bound 10 ms instead of 60 s.
    const release = new SlowRelease(
      {
        release: (lane) => runner.releaseLane?.(lane) ?? Promise.resolve(),
        lanes: () => [],
        endedAt: () => ended,
        now: () => Date.now() as EpochMs,
        closed: () => false,
      },
      10,
    );
    release.opened("slow:vitest");
    release.opened("group:e2e:vitest");
    release.arm();
    await expect
      .poll(() => log.filter((line) => line.endsWith(" close")).sort())
      .toEqual(["group:e2e:vitest#1 close", "slow:vitest#1 close"]);
    release.close();
    await runner.run([FILE], options("group:e2e:vitest"));
    expect(log.at(-1)).toBe("group:e2e:vitest#2 run group:e2e:vitest");
  });

  it("sizes the slow lane's instance as before groups, and a group's by its limits", () => {
    const e2e: CheckGroup = {
      name: "e2e",
      runner: "vitest",
      at: "stop",
      limits: { maxWorkers: 3, maxParallel: 1 },
    };
    const wide: CheckGroup = {
      name: "wide",
      runner: "vitest",
      at: "pause",
      limits: { maxParallel: 6 },
    };
    const plain: CheckGroup = { name: "plain", runner: "vitest", at: "edit" };
    const policy = { ...DEFAULT_POLICY, checks: [e2e, wide, plain] };
    const workers = (lane: string) => laneInstanceWorkers(vitestLaneGroup(policy, lane));
    const { maxWorkers, maxParallel } = DEFAULT_POLICY.slow;
    expect(laneInstanceWorkers(vitestLaneGroup(DEFAULT_POLICY, "slow:vitest"))).toBe(
      Math.max(maxWorkers, maxParallel),
    );
    expect({
      slow: workers("slow:vitest"),
      e2e: workers("group:e2e:vitest"),
      wide: workers("group:wide:vitest"),
      plain: workers("group:plain:vitest"),
      gone: workers("group:gone:vitest"),
    }).toEqual({
      slow: Math.max(maxWorkers, maxParallel),
      e2e: 3,
      wide: 6,
      plain: undefined,
      gone: undefined,
    });
    expect(vitestLaneGroup(policy, "group:e2e:vitest")?.name).toBe("e2e");
    expect(vitestLaneGroup(policy, "vitest")).toBeNull();
  });
});
