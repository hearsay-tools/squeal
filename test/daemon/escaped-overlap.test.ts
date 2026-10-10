import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { getPriority } from "node:os";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { afterEachRun, EscapedChildren, type RunSweeper } from "../../src/core/daemon/escaped.js";
import { statOf } from "../../src/core/daemon/terminate.js";
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
        new RegExp(
          `^stopped 1 process a test left running after its tier: ${escaped} .*, run short\\)$`,
        ),
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

/**
 * Leads a process group of its own and, per line on stdin, leaves an
 * unmarked sleeper orphaned in it, printing its pid: a daemon's group orphan
 * as `squeal daemon` spawned detached would hold it.
 */
const GROUP_LEADER = `const { spawn } = require("node:child_process");
const leaves = "const c = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], { stdio: 'ignore' }); console.log(c.pid); c.unref()";
process.stdin.on("data", () => {
  const parent = spawn(process.execPath, ["-e", leaves], { stdio: ["ignore", "pipe", "ignore"] });
  parent.stdout.on("data", (pid) => process.stdout.write(pid));
});
`;

/** A group leader with no mark in its env, killed with its group when the test ends. */
async function groupLeader(): Promise<{ pid: number; orphan: () => Promise<number> }> {
  const env = { ...process.env };
  delete env.SQUEAL_DAEMON_CHILD;
  const leader = spawn(process.execPath, ["-e", GROUP_LEADER], {
    env,
    stdio: ["pipe", "pipe", "ignore"],
    detached: true,
  });
  const pid = pidOf(leader);
  onTestFinished(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  });
  const pids: number[] = [];
  leader.stdout?.on("data", (data: Buffer) => {
    pids.push(...String(data).trim().split(/\s+/).map(Number));
  });
  // The group's strangers are read at construction; nothing but the leader is in it yet.
  await expect.poll(() => isAlive(pid)).toBe(true);
  return {
    pid,
    async orphan() {
      const before = pids.length;
      leader.stdin?.write("\n");
      await expect.poll(() => pids.length, { timeout: 10_000 }).toBeGreaterThan(before);
      const orphan = pids[before] ?? -1;
      // Its parent exited: it no longer descends from the leader.
      await expect.poll(() => statOf(orphan)?.ppid !== pid, { timeout: 10_000 }).toBe(true);
      return orphan;
    },
  };
}

describe.runIf(process.platform === "linux")(
  "afterEachRun, whose run a stop's process was (review wave-13r B1)",
  () => {
    /** A long run held open and a short run that settles inside it, through `afterEachRun`. */
    function overlapping(children: RunSweeper, short: (options: RunOptions) => Promise<void>) {
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let running = false;
      const notes: string[] = [];
      const runner = afterEachRun(
        fakeRunner(async (testFiles, runOptions) => {
          if (testFiles.includes(LONG)) {
            running = true;
            await held;
          } else {
            await short(runOptions);
          }
          return completed(testFiles);
        }),
        children,
        (text) => notes.push(text),
      );
      onTestFinished(() => release());
      return { runner, notes, release, running: () => running };
    }

    it("names both overlapping runs, uncertain, for a short run's bare-marker child", async () => {
      const children = new EscapedChildren();
      let leftover: ChildProcess | null = null;
      const { runner, notes, release, running } = overlapping(children, async () => {
        const child = spawn(process.execPath, SLEEPER, {
          env: { ...process.env, ...children.env },
          stdio: "ignore",
          detached: true,
        });
        child.unref();
        started.push(child);
        leftover = child;
      });
      const long = runner.run([LONG], options("long-run"));
      await expect.poll(running).toBe(true);
      await runner.run([SHORT], options("short-run"));
      const escaped = pidOf(leftover);
      // Left running while the other lane's run is in flight.
      expect(isAlive(escaped)).toBe(true);
      expect(notes).toEqual([]);
      release();
      await long;
      expect(isAlive(escaped)).toBe(false);
      expect(notes).toEqual([
        expect.stringMatching(
          new RegExp(
            `^stopped 1 process a test left running after its tier: ${escaped} .*, one of runs long-run, short-run\\)$`,
          ),
        ),
      ]);
    });

    it("names both overlapping runs, uncertain, for an unmarked orphan of the group", async () => {
      const leader = await groupLeader();
      const children = new EscapedChildren(randomUUID(), leader.pid);
      let orphan = -1;
      const { runner, notes, release, running } = overlapping(children, async () => {
        orphan = await leader.orphan();
      });
      const long = runner.run([LONG], options("long-run"));
      await expect.poll(running).toBe(true);
      await runner.run([SHORT], options("short-run"));
      expect(isAlive(orphan)).toBe(true);
      release();
      await long;
      expect(isAlive(orphan)).toBe(false);
      expect(notes).toEqual([
        expect.stringMatching(
          new RegExp(
            `^stopped 1 process a test left running after its tier: ${orphan} .*, one of runs long-run, short-run\\)$`,
          ),
        ),
      ]);
    });

    it("names its own run alone for a lane carrier, and for a shared leftover of a run that overlapped none", async () => {
      const children = new EscapedChildren();
      const pids: number[] = [];
      const notes: string[] = [];
      const runner = afterEachRun(
        fakeRunner(async (testFiles, runOptions) => {
          pids.push(pidOf(carrier(runOptions, true)));
          const bare = spawn(process.execPath, SLEEPER, {
            env: { ...process.env, ...children.env },
            stdio: "ignore",
            detached: true,
          });
          bare.unref();
          started.push(bare);
          pids.push(pidOf(bare));
          return completed(testFiles);
        }),
        children,
        (text) => notes.push(text),
      );
      await runner.run([SHORT], options("only-run"));
      expect(notes).toHaveLength(1);
      const [lane, bare] = pids;
      expect(notes[0]).toMatch(new RegExp(`${lane} [^;]*, run only-run\\)`));
      expect(notes[0]).toMatch(new RegExp(`${bare} [^;]*, run only-run\\)`));
      expect(notes[0]).not.toMatch(/one of runs/);
    });
  },
);
