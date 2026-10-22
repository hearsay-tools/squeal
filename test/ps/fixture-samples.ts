import type { Sample } from "../../src/core/ps/model.js";
import type {
  CpuTimes,
  HostReading,
  LockEntry,
  ProcessMemory,
  ProcessRow,
  ProcessTable,
  PsSource,
} from "../../src/core/ps/source.js";
import type { EpochMs } from "../../src/core/types/index.js";
import { CLOCK_TICKS } from "./fixture.js";

/*
 * Fixtures for measurement, test processes and the host (spec 014 D4 to D6,
 * task 014-07). `fakeSource` is a `PsSource` over rows held in memory, which
 * counts each read, so a test can state what a stage read and how often.
 */

export interface FakeProcess {
  readonly pid: number;
  readonly ppid: number;
  readonly comm?: string;
  readonly state?: string | null;
  readonly startTicks?: number;
  readonly cpuTicks?: number;
  /** `null`: the source reads none (D10). */
  readonly childTicks?: number | null;
  readonly nice?: number;
  readonly uid?: number | null;
  readonly cmdline?: readonly string[] | null;
  readonly mark?: string | null;
  readonly memory?: ProcessMemory | null;
}

export function rowOf(p: FakeProcess): ProcessRow {
  return {
    pid: p.pid,
    ppid: p.ppid,
    comm: p.comm ?? "node",
    state: p.state === undefined ? "S" : p.state,
    startTicks: p.startTicks ?? 1_000,
    cpuTicks: p.cpuTicks ?? 0,
    childTicks: p.childTicks === undefined ? 0 : p.childTicks,
    nice: p.nice ?? 0,
    uid: p.uid === undefined ? 1000 : p.uid,
  };
}

export function tableOf(processes: readonly FakeProcess[]): ProcessTable {
  return new Map(processes.map((p) => [p.pid, rowOf(p)]));
}

/** A sample of `processes`; with `cpuTime`, a host reading of `HOST` with those times. */
export function sampleOf(
  atMs: number,
  processes: readonly FakeProcess[],
  cpuTime: CpuTimes | null = null,
): Sample {
  return { atMs, table: tableOf(processes), host: cpuTime === null ? null : { ...HOST, cpuTime } };
}

export const HOST: HostReading = {
  load: [36.8, 41.3, 51.1],
  cpuPressure: 45.57,
  memoryPressure: { some: 0.64, full: 0.52 },
  memTotal: 47 * 2 ** 30,
  memAvailable: 14.3 * 2 ** 30,
  swapTotal: 4 * 2 ** 30,
  swapUsed: 4 * 2 ** 30,
  cpuTime: { busy: 1_000_000, total: 1_100_000 },
  cpus: 24,
};

export interface FakeOptions {
  readonly readsMarks?: boolean;
  readonly locks?: readonly LockEntry[] | null;
  readonly fileKeys?: Readonly<Record<string, string>>;
  readonly host?: HostReading;
  readonly bootTime?: EpochMs | null;
  readonly pidNamespace?: string | null;
}

/** A source over `processes`, and how many times each of its reads ran. */
export function fakeSource(
  processes: readonly FakeProcess[],
  options: FakeOptions = {},
): { readonly source: PsSource; readonly reads: Map<string, number> } {
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const reads = new Map<string, number>();
  const count = (name: string, n = 1): void => {
    reads.set(name, (reads.get(name) ?? 0) + n);
  };
  const readsMarks = options.readsMarks ?? true;
  const source: PsSource = {
    platform: readsMarks ? "linux" : "darwin",
    memoryKind: readsMarks ? "private" : "rss",
    readsMarks,
    clockTicks: () => CLOCK_TICKS,
    bootTime: () => options.bootTime ?? null,
    processTable(pids, since) {
      const chosen =
        pids === undefined
          ? processes
          : processes.filter(
              (p) => pids.includes(p.pid) || (since !== undefined && !since.has(p.pid)),
            );
      count("stat", chosen.length);
      return tableOf(chosen);
    },
    cmdline(pid) {
      count("cmdline");
      return byPid.get(pid)?.cmdline ?? null;
    },
    markOf(pid) {
      count("environ");
      return readsMarks ? (byPid.get(pid)?.mark ?? null) : null;
    },
    memory(pid) {
      count("status");
      return byPid.get(pid)?.memory ?? null;
    },
    fds: () => null,
    locks() {
      count("locks");
      return options.locks ?? null;
    },
    fileKey: (path) => options.fileKeys?.[path] ?? null,
    unixListeners: () => null,
    pidNamespace: () => options.pidNamespace ?? null,
    host() {
      count("host");
      return options.host ?? HOST;
    },
  };
  return { source, reads };
}

/** Counts each method call of `source` by its name. */
export function countingSource(source: PsSource): {
  readonly source: PsSource;
  readonly reads: Map<string, number>;
} {
  const reads = new Map<string, number>();
  const counted = new Proxy(source, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const name = String(key);
        const first = args[0];
        const n = name === "processTable" && Array.isArray(first) ? first.length : 1;
        reads.set(name, (reads.get(name) ?? 0) + n);
        return value.apply(target, args);
      };
    },
  });
  return { source: counted, reads };
}
