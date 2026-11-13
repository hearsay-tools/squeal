import { afterEach, describe, expect, it, vi } from "vitest";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { RunOptions, RunReport } from "../../src/core/types/runner.js";
import { NO_TRAITS } from "../../src/core/types/runner-traits.js";

/*
 * Spec 019 D3 (row 019-12): a run's processes take idle I/O (`ionice -c 3`)
 * by the run's priority, not by its lane's prefix; every run's take `nice`
 * 10 (011 C10). A run that names no priority keeps today's: `"low"` in a
 * slow lane alone (spec 004 D2). The kernel's table, the priority calls and
 * `execFile` are stood in for, so each run's carrier is one known pid.
 */

const kernel = vi.hoisted(() => ({
  table: new Map<number, number>(),
  niced: [] as number[],
  idled: [] as number[],
}));

vi.mock("node:os", async (actual) => ({
  ...(await actual<typeof import("node:os")>()),
  getPriority: () => 0,
  setPriority: (pid: number) => {
    kernel.niced.push(pid);
  },
}));

vi.mock("node:child_process", async (actual) => ({
  ...(await actual<typeof import("node:child_process")>()),
  execFile: (_file: string, args: string[], done: (error: unknown) => void) => {
    kernel.idled.push(...args.slice(3).map(Number));
    done(null);
    return { unref: () => {} };
  },
}));

vi.mock("../../src/core/daemon/terminate.js", async (actual) => ({
  ...(await actual<typeof import("../../src/core/daemon/terminate.js")>()),
  childrenOf: () => [],
  statOf: (pid: number) => {
    const start = kernel.table.get(pid);
    return start === undefined ? null : { pid, ppid: 1, pgrp: 1, start };
  },
}));

const { afterEachRun } = await import("../../src/core/daemon/escaped.js");
const { runPriority } = await import("../../src/core/daemon/low-priority.js");

afterEach(() => {
  kernel.table.clear();
  kernel.niced = [];
  kernel.idled = [];
});

const FILE: TestFileRef = { project: "", path: "test/a.test.ts" };
const CARRIER = 101;

/** The runner `afterEachRun` wraps: each run lasts until its carrier is lowered. */
const runner = {
  name: "vitest",
  adapterVersion: "1",
  traits: NO_TRAITS,
  invalidate: async () => ({ recreatedProjects: [] }),
  affected: async () => ({ direct: [], transitive: [] }),
  closure: async (testFile: TestFileRef) => ({ testFile, paths: [] }),
  enumerate: async () => [],
  testFiles: async () => [FILE],
  environment: async () => [],
  async run(testFiles: readonly TestFileRef[]): Promise<RunReport> {
    for (let waited = 0; !kernel.niced.includes(CARRIER) && waited < 5_000; waited += 20)
      await new Promise((r) => setTimeout(r, 20));
    // One more look's time: an `ionice` would follow the `nice` at once.
    await new Promise((r) => setTimeout(r, 50));
    return {
      end: "completed",
      durationMs: 1,
      completedFiles: testFiles,
      results: [],
      fileErrors: [],
      failure: null,
    };
  },
  close: async () => {},
};

/** The daemon's children: every look finds the run's one carrier. */
const children = {
  mark: () => 0,
  envFor: (mark: string) => ({ MARK: mark }),
  afterRun: async () => null,
  carriers: async () => [{ pid: CARRIER, ppid: 1, pgrp: 1, start: 1 }],
};

/** No process outlives a run. */
const table = {
  mark: () => 0,
  list: async () => [],
  variable: async () => null,
  running: async () => [],
  command: async () => "",
};

/** What a run in `lane` at `priority` did to its carrier. */
async function ran(lane: string, priority?: RunOptions["priority"]) {
  kernel.table.set(CARRIER, 1);
  const options: RunOptions = {
    runId: "r",
    logDir: "/tmp/r",
    timeoutMs: null,
    lane,
    ...(priority === undefined ? {} : { priority }),
  };
  await afterEachRun(runner, children, () => {}, table).run([FILE], options);
  return { nice: kernel.niced.includes(CARRIER), idleIo: kernel.idled.includes(CARRIER) };
}

describe("a run's priority (spec 019 D3, row 019-12)", () => {
  it("defaults to low in a slow lane alone, as before groups", () => {
    expect([
      runPriority(undefined, "slow:vitest"),
      runPriority(undefined, "slow:node-test"),
      runPriority(undefined, "vitest"),
      runPriority(undefined, "beside:vitest"),
      runPriority(undefined, "group:e2e:vitest"),
      runPriority("normal", "slow:vitest"),
      runPriority("low", "vitest"),
    ]).toEqual(["low", "low", "normal", "normal", "normal", "normal", "low"]);
  });

  describe.runIf(process.platform === "linux")("through afterEachRun", () => {
    it("gives a low run's processes idle I/O in any lane", async () => {
      expect(await ran("group:e2e:vitest", "low")).toEqual({ nice: true, idleIo: true });
      kernel.niced = [];
      kernel.idled = [];
      expect(await ran("vitest", "low")).toEqual({ nice: true, idleIo: true });
    });

    it("gives a normal run's processes nice 10 alone, in a slow lane too", async () => {
      expect(await ran("slow:vitest", "normal")).toEqual({ nice: true, idleIo: false });
      kernel.niced = [];
      expect(await ran("group:e2e:vitest", "normal")).toEqual({ nice: true, idleIo: false });
    });

    it("keeps today's for a run that names none: idle I/O in a slow lane alone", async () => {
      expect(await ran("slow:vitest")).toEqual({ nice: true, idleIo: true });
      kernel.niced = [];
      kernel.idled = [];
      expect(await ran("vitest")).toEqual({ nice: true, idleIo: false });
    });
  });
});
