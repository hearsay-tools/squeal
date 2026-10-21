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
  lockLine,
  makeHost,
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

export { DAEMON_AGE_S, STARTED_AT };
