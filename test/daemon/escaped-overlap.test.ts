import { type ChildProcess, spawn } from "node:child_process";
import { getPriority } from "node:os";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { afterEachRun, EscapedChildren, type RunSweeper } from "../../src/core/daemon/escaped.js";
import type {
  RunnerAdapter,
  RunOptions,
  RunReport,
  TestFileRef,
} from "../../src/core/types/index.js";
import { isAlive } from "./strays.js";

/*
 * Spec 001 D12 with D5 as amended (task 001-140): runs of two lanes overlap,
 * and the stop after a run must not hit the other run's workers. Each run's
 * processes carry the mark of its lane, `<daemon>:<lane>` (task 004-18), so
 * a run's stop reaches its own lane only, at once; and a slow lane's
 * processes run at low priority (spec 004 D2).
 */

const SLEEPER = ["-e", "setTimeout(() => {}, 600000)"];
const started: ChildProcess[] = [];

afterEach(() => {
  for (const child of started.splice(0)) if (isAlive(child.pid ?? -1)) child.kill("SIGKILL");
});

/** A process carrying the run's mark, as a Vitest worker or what a test starts with its env. */
function carrier(options: RunOptions, detached: boolean): ChildProcess {
  const child = spawn(process.execPath, SLEEPER, {
    env: { ...process.env, ...options.childEnv },
    stdio: "ignore",
    detached,
  });
  child.unref();
  started.push(child);
  return child;
}

function completed(testFiles: readonly TestFileRef[]): RunReport {
  return {
    end: "completed",
    durationMs: 1,
    completedFiles: testFiles,
    results: [],
    fileErrors: [],
    failure: null,
  };
}

const LONG: TestFileRef = { project: "", path: "test/long.test.ts" };
const SHORT: TestFileRef = { project: "unit", path: "test/short.test.ts" };

function fakeRunner(run: RunnerAdapter["run"]): RunnerAdapter {
  return {
    name: "vitest+node-test",
    adapterVersion: "1",
    invalidate: async () => ({ recreatedProjects: [] }),
    affected: async () => ({ direct: [], transitive: [] }),
    closure: async (testFile) => ({ testFile, paths: [] }),
    enumerate: async () => [],
    testFiles: async () => [LONG, SHORT],
    environment: async () => [],
    lane: (testFile) => (testFile.project === "" ? "vitest" : "node-test"),
    run,
    close: async () => {},
  };
}

const options = (runId: string, lane?: string): RunOptions => ({
  runId,
  logDir: `/tmp/${runId}`,
  timeoutMs: null,
  ...(lane === undefined ? {} : { lane }),
});

const pidOf = (child: ChildProcess | null): number => child?.pid ?? -1;

describe.runIf(process.platform === "linux")("afterEachRun, a mark per lane (task 004-18)", () => {
  it("stops a short run's escape when it ends, never the long run's worker", async () => {
    const children = new EscapedChildren();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let worker: ChildProcess | null = null;
    let leftover: ChildProcess | null = null;
    const notes: string[] = [];
    const runner = afterEachRun(
      fakeRunner(async (testFiles, runOptions) => {
        if (testFiles.includes(LONG)) {
          // A worker that lives for the whole run, then exits with it.
          worker = carrier(runOptions, false);
          await held;
          worker.kill("SIGTERM");
        } else {
          leftover = carrier(runOptions, true);
        }
        return completed(testFiles);
      }),
      children,
      (text) => notes.push(text),
    );
    expect(runner.lane?.(SHORT)).toBe("node-test");

    const long = runner.run([LONG], options("long"));
    await expect.poll(() => worker).not.toBeNull();
    await runner.run([SHORT], options("short"));
    const escaped = pidOf(leftover);
    expect(isAlive(escaped)).toBe(false);
    expect(isAlive(pidOf(worker))).toBe(true);
    expect(notes).toEqual([
      expect.stringMatching(
        new RegExp(`^stopped 1 process a test left running after its tier: ${escaped} `),
      ),
    ]);
    release();
    await long;
    expect(notes).toHaveLength(1);
  });

  it("never stops a worker another lane starts while a settled run's stop is under way (review 001-149 B1)", async () => {
    const children = new EscapedChildren();
    // The reviewer's probe: the stop after lane node-test's run waits at a barrier before its scan.
    let atBarrier = false;
    let pass = () => {};
    const barrier = new Promise<void>((resolve) => {
      pass = resolve;
    });
    const sweeper: RunSweeper = {
      mark: () => children.mark(),
      envFor: (lane) => children.envFor(lane),
      carriers: (lane, since) => children.carriers(lane, since),
      async afterRun(lane, since, alone) {
        if (lane === "node-test") {
          atBarrier = true;
          await barrier;
        }
        return children.afterRun(lane, since, alone);
      },
    };
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let worker: ChildProcess | null = null;
    const notes: string[] = [];
    const runner = afterEachRun(
      fakeRunner(async (testFiles, runOptions) => {
        if (testFiles.includes(LONG)) {
          worker = carrier(runOptions, true);
          await held;
        }
        return completed(testFiles);
      }),
      sweeper,
      (text) => notes.push(text),
    );
    onTestFinished(() => {
      pass();
      release();
    });

    // Lane node-test settles alone, so its stop reaches the bare mark and orphans too.
    const short = runner.run([SHORT], options("short"));
    await expect.poll(() => atBarrier).toBe(true);
    // Lane vitest starts meanwhile; its detached worker carries its own lane's mark.
    const long = runner.run([LONG], options("long"));
    await expect.poll(() => worker).not.toBeNull();
    const working = pidOf(worker);
    await expect.poll(() => isAlive(working)).toBe(true);
    pass();
    await short;
    expect(isAlive(working)).toBe(true);
    expect(notes).toEqual([]);

    // Its own stop reaches it once its run settles.
    release();
    await long;
    expect(isAlive(working)).toBe(false);
    expect(notes).toEqual([
      expect.stringMatching(
        new RegExp(`^stopped 1 process a test left running after its tier: ${working} `),
      ),
    ]);
  });

  it("runs a slow lane's processes at nice 10, and a fast run's stop leaves them running", async () => {
    const children = new EscapedChildren();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let worker: ChildProcess | null = null;
    let fast: ChildProcess | null = null;
    const runner = afterEachRun(
      fakeRunner(async (testFiles, runOptions) => {
        if (runOptions.lane === "slow:vitest") {
          worker = carrier(runOptions, false);
          await held;
        } else {
          // A fast tier that leaves a process behind and settles while the slow file runs.
          fast = carrier(runOptions, true);
          await expect.poll(() => getPriority(pidOf(worker)), { timeout: 10_000 }).toBe(10);
          expect(getPriority(pidOf(fast))).toBe(getPriority());
        }
        return completed(testFiles);
      }),
      children,
      () => {},
    );
    const slow = runner.run([LONG], options("slow", "slow:vitest"));
    await expect.poll(() => worker).not.toBeNull();
    await runner.run([SHORT], options("fast"));
    expect(isAlive(pidOf(fast))).toBe(false);
    expect(isAlive(pidOf(worker))).toBe(true);
    release();
    await slow;
  });
});
