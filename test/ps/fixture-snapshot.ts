import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import { createProcSource } from "../../src/core/ps/proc.js";
import type { PsDaemon, PsSnapshot, PsTestProcess } from "../../src/core/ps/shape.js";
import type { PsSource } from "../../src/core/ps/source.js";
import type { DaemonRecord, EpochMs, Store } from "../../src/core/types/index.js";
import { BOOT_SECONDS, type FixtureProcess, statLine } from "./fixture.js";
import {
  DAEMON_AGE_S,
  daemonProcess,
  daemonRecord,
  type FixtureHost,
  type FixtureRepo,
  HOME,
  lockLine,
  makeHost,
  NODE,
  STARTED_AT,
  writeLocks,
  writeProcesses,
  writeStore,
} from "./fixture-stores.js";

/*
 * Fixtures for the snapshot and the command (spec 014 D1, D4, D8; task
 * 014-11): a fixture host of `fixture-stores.ts` with daemons that hold
 * their locks and have their stores, and a window whose two clocks the test
 * moves. The wait is injected and `performance.now` is replaced, so the
 * window is exactly as long as the snapshot asks and no test sleeps; a test
 * changes the `/proc` tree during the wait to give a process its CPU.
 */

/** The snapshot's epoch clock at the first sample: a minute after the fixture daemons registered. */
export const NOW: EpochMs = STARTED_AT + 60_000;

export interface FakeWindow {
  readonly now: () => EpochMs;
  readonly wait: (ms: number) => Promise<void>;
  /** Each wait's length. */
  readonly waits: number[];
}

/**
 * A window over a fake `performance.now` and epoch clock: `wait(ms)` moves
 * both by `ms` and runs `during` first, as if the host changed meanwhile.
 * Restore with `vi.restoreAllMocks()`.
 */
export function fakeWindow(during: () => void = () => {}, start: EpochMs = NOW): FakeWindow {
  let mono = 1_000;
  let epoch = start;
  vi.spyOn(performance, "now").mockImplementation(() => mono);
  const waits: number[] = [];
  return {
    now: () => epoch,
    wait: async (ms) => {
      waits.push(ms);
      during();
      mono += ms;
      epoch += ms;
    },
    waits,
  };
}

/** A fixture host whose `/proc/locks` collects each daemon's held lock. */
export interface SnapshotHost extends FixtureHost {
  readonly source: PsSource;
  /** Writes daemon `pid` of `repo`, its held lock, and its store with `record` (`null`: none). */
  serve(
    pid: number,
    repo: FixtureRepo,
    options?: {
      readonly record?: DaemonRecord | null;
      readonly fill?: (store: Store) => void;
      readonly process?: Partial<FixtureProcess>;
    },
  ): FixtureProcess;
}

export function snapshotHost(): SnapshotHost {
  const host = makeHost();
  const source = createProcSource({
    root: host.base,
    availableParallelism: () => 24,
    run: () => null,
  });
  const locks: string[] = [];
  return {
    ...host,
    source,
    serve(pid, repo, options = {}) {
      const p = {
        ...daemonProcess({ pid, root: repo.root, lockPath: repo.lockPath }),
        ...options.process,
      };
      writeProcesses(host, [p]);
      locks.push(lockLine(locks.length + 1, pid, source.fileKey(repo.lockPath) ?? ""));
      writeLocks(host, locks);
      const record = options.record === undefined ? daemonRecord(repo) : options.record;
      writeStore(repo, record, options.fill);
      return p;
    },
  };
}

/** `p` with `ticks` more CPU ticks: its `stat` rewritten, as at the window's end. */
export function addTicks(host: FixtureHost, p: FixtureProcess, ticks: number): FixtureProcess {
  const total = Math.round(p.lifeCpuPct * p.ageS) + ticks;
  const later = { ...p, lifeCpuPct: total / p.ageS };
  writeFileSync(join(host.base, "proc", String(p.pid), "stat"), statLine(later));
  return later;
}

/** `/proc/stat` with the CPU times `busy` and `idle`, in ticks summed over every CPU. */
export function writeCpuTimes(host: FixtureHost, busy: number, idle: number): void {
  writeFileSync(
    join(host.base, "proc", "stat"),
    [`cpu  ${busy} 0 0 ${idle} 0 0 0 0 0 0`, "intr 1 2 3", `btime ${BOOT_SECONDS}`, ""].join("\n"),
  );
}

/** An open run of `repo` since `startedAt`, of `files` test files. */
export function startRun(
  store: Store,
  repo: FixtureRepo,
  id: string,
  startedAt: EpochMs,
  files = 1,
): void {
  store.runs.start({
    id,
    worktreeId: repo.id,
    revision: 1,
    testFiles: Array.from({ length: files }, (_, i) => ({
      project: "default",
      path: `test/${i}.test.ts`,
    })),
    checkpointId: null,
    logDir: "/tmp/runs",
    startedAt,
  });
}

/** A Vitest fork worker of daemon `ppid`, its mark `<token>:<lane>`. */
export function forkWorker(pid: number, ppid: number, mark: string | null): FixtureProcess {
  return {
    pid,
    ppid,
    pgid: ppid,
    comm: "MainThread",
    nice: 10,
    ageS: 240,
    lifeCpuPct: 5,
    cmdline: [NODE, `${HOME}/projects/alpha/node_modules/vitest/dist/workers/forks.js`],
    environ: mark === null ? {} : { SQUEAL_DAEMON_CHILD: mark, NODE_ENV: "test" },
    memoryKb: { anon: 150_000, shmem: 10_000, swap: 2_000 },
  };
}

/** A test's child without a mark: a `git` its test ran. */
export function gitChild(pid: number, ppid: number): FixtureProcess {
  return {
    pid,
    ppid,
    pgid: ppid,
    comm: "git",
    nice: 10,
    ageS: 2,
    lifeCpuPct: 50,
    cmdline: ["git", "status"],
    environ: { GIT_DIR: "/x/.git" },
    memoryKb: { anon: 4_000, shmem: 0, swap: 0 },
  };
}

export { DAEMON_AGE_S, STARTED_AT };

const GIB = 2 ** 30;
const MIB = 2 ** 20;
const MINUTE = 60_000;
/** When the D8 example was taken. */
export const EXAMPLE_AT: EpochMs = 1_792_600_000_000;

/** A test process of the D8 example's shape. */
export function exampleProcess(overrides: Partial<PsTestProcess> = {}): PsTestProcess {
  return {
    pid: 3704700,
    lane: "vitest",
    runner: "vitest",
    runId: "r1",
    files: null,
    escaped: false,
    cpuPct: 10,
    cpuMs: 27_000,
    privateBytes: 300 * MIB,
    swapBytes: 0,
    nice: 10,
    startedAt: EXAMPLE_AT - 4 * MINUTE,
    descendants: {
      count: 2,
      cpuPct: 2,
      cpuMs: 2_000,
      privateBytes: 10 * MIB,
      swapBytes: 0,
      list: null,
    },
    flags: [],
    ...overrides,
  };
}

/** A daemon of the D8 example's shape: serving, a fast tier of 200 files. */
export function exampleDaemon(overrides: Partial<PsDaemon> = {}): PsDaemon {
  return {
    pid: 3704612,
    phase: "serving",
    state: "serving",
    worktreeId: "f1ca49e6aa00bb11",
    root: "/home/user/projects/cezar",
    version: "0.1.235",
    harness: "codex",
    startedAt: EXAMPLE_AT - 39 * MINUTE,
    cpuPct: 30,
    cpuMs: 702_000,
    privateBytes: 2.2 * GIB,
    swapBytes: 264 * MIB,
    permits: 1,
    work: {
      pending: 0,
      running: 200,
      tiers: [
        {
          runId: "r1",
          lane: "fast",
          files: 200,
          startedAt: EXAMPLE_AT - MINUTE,
          checkpointId: null,
        },
      ],
      checkpoints: [],
      departedAt: null,
      drainLeftMs: null,
      lastUsedAt: EXAMPLE_AT - MINUTE,
    },
    consumers: [],
    processes: [],
    flags: [],
    ...overrides,
  };
}

/** The D8 example as a shape: three daemons of one repository, a stale socket and the leftovers. */
export function exampleSnapshot(overrides: Partial<PsSnapshot> = {}): PsSnapshot {
  const idle = exampleDaemon().work;
  return {
    v: 1,
    at: EXAMPLE_AT,
    sampleMs: 2_000,
    platform: "linux",
    memory: "private",
    host: {
      load: [36.8, 41.3, 51.1],
      cpus: 24,
      cpuPressure: 45.2,
      memoryPressure: { some: 0.64, full: 0.52 },
      memTotal: 47 * GIB,
      memAvailable: 14.3 * GIB,
      swapTotal: 4 * GIB,
      swapUsed: 4 * GIB,
      busyCpuPct: 92,
    },
    squeal: {
      daemons: 3,
      testProcesses: 1,
      cpuPct: 810,
      cpuShare: 36.4,
      privateBytes: 21 * GIB,
      memoryShare: 64.2,
      swapBytes: GIB,
      pool: { slots: 12, held: 3 },
    },
    repositories: [
      {
        commonDir: "/home/user/projects/cezar/.git",
        current: true,
        daemons: [
          exampleDaemon({ processes: [exampleProcess()] }),
          exampleDaemon({
            pid: 2721938,
            state: "draining 22m left",
            worktreeId: "aee4a33f00000000",
            startedAt: EXAMPLE_AT - 61 * MINUTE,
            cpuPct: 16,
            cpuMs: 550_000,
            privateBytes: 1.1 * GIB,
            swapBytes: 80 * MIB,
            work: {
              ...idle,
              tiers: [],
              pending: 120,
              departedAt: EXAMPLE_AT - 38 * MINUTE,
              drainLeftMs: 22 * MINUTE,
            },
          }),
          exampleDaemon({
            pid: 3241641,
            state: "older (session 3212240 holds it)",
            worktreeId: "70b80c8e00000000",
            version: "0.1.234",
            harness: "claude",
            startedAt: EXAMPLE_AT - 49 * MINUTE,
            cpuPct: 12,
            cpuMs: 351_000,
            privateBytes: 821 * MIB,
            swapBytes: 0,
            work: { ...idle, tiers: [] },
          }),
        ],
      },
    ],
    orphans: [],
    files: [
      {
        flag: "stale-socket",
        reason:
          "no live daemon of worktree fd5a859b8ca77ef9 holds its lock; changed 2026-10-16 20:36",
        path: "/run/user/1001/squeal-fd5a859b8ca77ef9.sock",
        count: 1,
        bytes: null,
        command: "rm /run/user/1001/squeal-fd5a859b8ca77ef9.sock",
      },
      {
        flag: "leftover-temp",
        reason: "no live daemon's key names them and no process uses them, older than 1 h",
        path: null,
        count: 3_530,
        bytes: 6.4 * GIB,
        command: "squeal ps --leftovers | xargs -d '\\n' rm -rf --",
      },
    ],
    unflaggedFiles: null,
    flags: 2,
    unknown: [],
    ...overrides,
  };
}
