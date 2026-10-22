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
import { CLOCK_TICKS, type FixtureProcess, writeProcess } from "./fixture.js";

/*
 * Fixtures for measurement, test processes and the host (spec 014 D4 to D6,
 * task 014-07). `fakeSource` is a `PsSource` over rows held in memory, which
 * counts each read, so a test can state what a stage read and how often.
 * `writeHostTree` writes the 650-process `/proc` tree of the cost bound
 * (spec 014 Testing, goal 6) with the shape of the 2026-10-21 host
 * (`research/process-measurement.md` 5): 25 daemons, their fork workers and
 * their tests' children, and the rest of the host's processes.
 */

export interface FakeProcess {
  readonly pid: number;
  readonly ppid: number;
  readonly comm?: string;
  readonly state?: string;
  readonly startTicks?: number;
  readonly cpuTicks?: number;
  /** `null`: the source reads none (D10). */
  readonly childTicks?: number | null;
  readonly nice?: number;
  readonly cmdline?: readonly string[] | null;
  readonly mark?: string | null;
  readonly memory?: ProcessMemory | null;
}

export function rowOf(p: FakeProcess): ProcessRow {
  return {
    pid: p.pid,
    ppid: p.ppid,
    pgid: p.pid,
    comm: p.comm ?? "node",
    state: p.state ?? "S",
    startTicks: p.startTicks ?? 1_000,
    cpuTicks: p.cpuTicks ?? 0,
    childTicks: p.childTicks === undefined ? 0 : p.childTicks,
    nice: p.nice ?? 0,
    uid: 1000,
  };
}

export function tableOf(processes: readonly FakeProcess[]): ProcessTable {
  return new Map(processes.map((p) => [p.pid, rowOf(p)]));
}

export function sampleOf(
  atMs: number,
  processes: readonly FakeProcess[],
  cpuTime: CpuTimes | null = null,
): Sample {
  return { atMs, table: tableOf(processes), cpuTime };
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
    bootTime: () => null,
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
    pidNamespace: () => null,
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

const HOME = "/home/user";
const NODE = `${HOME}/.nvm/versions/node/v24.21.0/bin/node`;

/** The 650-process host: what each daemon is, and which pids are Squeal's. */
export interface HostTree {
  readonly daemons: readonly number[];
  readonly tokens: ReadonlyMap<number, string>;
  /** The daemons, their fork workers and their tests' children: what `Measure` reads after the window. */
  readonly squeal: readonly number[];
  readonly testProcesses: number;
}

/** 25 daemons, each with one fork worker and its `git`, 1 escaped browser each for 5 of them, and 545 others. */
export function writeHostTree(root: string): HostTree {
  const processes: FixtureProcess[] = [];
  const add = (p: Omit<FixtureProcess, "nice" | "ageS" | "lifeCpuPct"> & Partial<FixtureProcess>) =>
    processes.push({ nice: 0, ageS: 600, lifeCpuPct: 1, ...p });
  add({ pid: 1049, ppid: 1, pgid: 1049, comm: "systemd", cmdline: ["/usr/lib/systemd/systemd"] });
  const daemons: number[] = [];
  const tokens = new Map<number, string>();
  const squeal: number[] = [];
  let testProcesses = 0;
  for (let d = 0; d < 25; d++) {
    const pid = 300_000 + d * 10;
    const token = `00000000-0000-4000-8000-${String(d).padStart(12, "0")}`;
    daemons.push(pid);
    tokens.set(pid, token);
    const project = `${HOME}/projects/p${d}`;
    const memoryKb = { anon: 400_000, shmem: 0, swap: 1_000 };
    add({
      pid,
      ppid: 1049,
      pgid: pid,
      comm: "MainThread",
      cmdline: [
        NODE,
        `${HOME}/.claude/plugins/cache/hearsay/squeal/0.1.235/dist/cli/squeal.mjs`,
        "daemon",
        project,
      ],
      memoryKb,
    });
    const mark = `${token}:vitest`;
    add({
      pid: pid + 1,
      ppid: pid,
      pgid: pid,
      comm: "MainThread",
      nice: 10,
      cmdline: [NODE, `${project}/node_modules/vitest/dist/workers/forks.js`],
      environ: { SQUEAL_DAEMON_CHILD: mark, NODE_ENV: "test" },
      memoryKb: { anon: 150_000, shmem: 0, swap: 0 },
    });
    add({
      pid: pid + 2,
      ppid: pid + 1,
      pgid: pid,
      comm: "git",
      nice: 10,
      cmdline: ["git", "status"],
      environ: { GIT_DIR: `${project}/.git` },
      memoryKb: { anon: 4_000, shmem: 0, swap: 0 },
    });
    squeal.push(pid, pid + 1, pid + 2);
    testProcesses += 1;
    if (d % 5 === 0) {
      add({
        pid: pid + 3,
        ppid: 1049,
        pgid: pid + 3,
        comm: "chrome",
        nice: 10,
        cmdline: ["/usr/bin/google-chrome", "--no-first-run"],
        environ: { SQUEAL_DAEMON_CHILD: `${token}:slow:vitest` },
        memoryKb: { anon: 80_000, shmem: 26_000, swap: 0 },
      });
      squeal.push(pid + 3);
      testProcesses += 1;
    }
  }
  for (let i = 0; processes.length < 650; i++) {
    const pid = 10_000 + i;
    add({
      pid,
      ppid: i % 3 === 0 ? 1049 : 10_000 + Math.floor(i / 3),
      pgid: pid,
      comm: i % 4 === 0 ? "MainThread" : "bash",
      cmdline: ["bash", "-l"],
      environ: { HOME, PATH: "/usr/bin", TERM: "xterm" },
      memoryKb: { anon: 5_000, shmem: 0, swap: 0 },
    });
  }
  for (const p of processes) writeProcess(root, p);
  return { daemons, tokens, squeal, testProcesses };
}
