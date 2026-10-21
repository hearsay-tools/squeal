import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import { createProcSource } from "../../src/core/ps/proc.js";
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
