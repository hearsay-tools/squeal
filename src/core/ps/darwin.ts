import { availableParallelism, type CpuInfo, cpus, loadavg, totalmem, uptime } from "node:os";
import { basename } from "node:path";
import type { EpochMs } from "../types/index.js";
import {
  type CommandRunner,
  type CpuTimes,
  type HostReading,
  type LockEntry,
  type MemoryKind,
  type ProcessMemory,
  type ProcessRow,
  type ProcessTable,
  type PsSource,
  runCommand,
  type UnixListener,
} from "./source.js";

/*
 * Spec 014 D10: the macOS source, built from `ps`, `vm_stat`, `sysctl`,
 * `lsof` and `node:os`, all *inferred*: nobody has run it on a Mac. Each
 * `processTable` is one `ps`, and throws when it fails; a process's
 * arguments and RSS are those of the last one, so no read spawns per
 * process. Each `host` is one `vm_stat`
 * and one `sysctl`, each `cwds` one `lsof`. It reads no marks, fds, locks
 * or listening sockets: those are `null`, and the stages name them in
 * `unknown`. Every spawn goes through the runner, without a shell.
 */

export interface DarwinSourceOptions {
  /** Runs `ps`, `vm_stat`, `sysctl` and `lsof`; tests replace it with fixture outputs. */
  readonly run?: CommandRunner;
  readonly os?: DarwinOs;
  /** The epoch clock the boot time is read against. */
  readonly now?: () => EpochMs;
}

/** The `node:os` reads of the host (D10). */
export interface DarwinOs {
  readonly loadavg: () => readonly number[];
  readonly totalmem: () => number;
  /** Only each CPU's `times`, in ms, is read. */
  readonly cpus: () => readonly { readonly times: CpuInfo["times"] }[];
  readonly availableParallelism: () => number;
  /** Seconds since boot: whole seconds on macOS (`kern.boottime`). */
  readonly uptime: () => number;
}

/** `time=` prints hundredths of a second. */
const CLOCK_TICKS = 100;
/**
 * D10's one table read; `uid=` keeps another user's daemons out (D2). `env`
 * runs it with `LC_TIME=C`, so `lstart` prints `%c` as
 * `Tue Oct 21 10:23:45 2026` in any locale; `LC_ALL` would override it.
 */
const PS: readonly string[] = [
  "-u",
  "LC_ALL",
  "LC_TIME=C",
  "ps",
  "-axww",
  "-o",
  "pid=,ppid=,pgid=,uid=,nice=,time=,rss=,lstart=,command=",
];
const ROW =
  /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\S+)\s+(\d+)\s+[A-Z][a-z]{2}\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})(?:\s+(.*))?$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** `M:SS.cc` on macOS, minutes past 59 included; `[[DD-]HH:]MM:SS` elsewhere. */
const TIME = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d{2})(?:\.(\d+))?$/;

/** One row of a `ps` read with what `cmdline` and `memory` give of it. */
interface PsLine {
  readonly row: ProcessRow;
  readonly args: readonly string[] | null;
  readonly rssBytes: number;
}

export function createDarwinSource(options: DarwinSourceOptions = {}): PsSource {
  return new DarwinSource(options);
}

class DarwinSource implements PsSource {
  readonly platform = "darwin";
  readonly memoryKind: MemoryKind = "rss";
  readonly readsMarks = false;
  readonly #run: CommandRunner;
  readonly #os: DarwinOs;
  /** Read once, so a process's start ticks are the same in every read: with its pid, its identity. */
  readonly #boot: EpochMs | null;
  #last: ReadonlyMap<number, PsLine> = new Map();

  constructor(options: DarwinSourceOptions) {
    this.#run = options.run ?? runCommand;
    this.#os = options.os ?? { loadavg, totalmem, cpus, availableParallelism, uptime };
    const boot = (options.now ?? Date.now)() - this.#os.uptime() * 1000;
    // To the second, as `kern.boottime` and `lstart` count: a start is then whole ticks after it.
    this.#boot = Number.isFinite(boot) ? Math.floor(boot / 1000) * 1000 : null;
  }

  clockTicks(): number {
    return CLOCK_TICKS;
  }

  bootTime(): EpochMs | null {
    return this.#boot;
  }

  processTable(pids?: readonly number[], since?: ProcessTable): ProcessTable {
    if (pids?.length === 0 && since === undefined) return new Map();
    this.#last = this.#read();
    const wanted = pids === undefined ? null : new Set(pids);
    const table = new Map<number, ProcessRow>();
    for (const [pid, line] of this.#last)
      if ((wanted?.has(pid) ?? true) || (since !== undefined && !since.has(pid)))
        table.set(pid, line.row);
    return table;
  }

  cmdline(pid: number): readonly string[] | null {
    return this.#last.get(pid)?.args ?? null;
  }

  markOf(): string | null {
    return null;
  }

  memory(pid: number): ProcessMemory | null {
    const line = this.#last.get(pid);
    return line === undefined ? null : { bytes: line.rssBytes, swapBytes: null };
  }

  fds(): readonly string[] | null {
    return null;
  }

  /** `lsof -F pn` prints a `p<pid>` line, then each file's `f<fd>` and `n<name>` lines. */
  cwds(pids: readonly number[]): ReadonlyMap<number, string> | null {
    if (pids.length === 0) return new Map();
    const text = this.#run("lsof", ["-d", "cwd", "-F", "pn"]);
    if (text === null) return null;
    const wanted = new Set(pids);
    const cwds = new Map<number, string>();
    let pid: number | null = null;
    let fd: string | null = null;
    for (const line of text.split("\n")) {
      const value = line.slice(1);
      if (line.startsWith("p")) {
        pid = /^\d+$/.test(value) ? Number(value) : null;
        fd = null;
      } else if (line.startsWith("f")) fd = value;
      else if (line.startsWith("n") && pid !== null && (fd ?? "cwd") === "cwd" && wanted.has(pid))
        cwds.set(pid, value);
    }
    return cwds;
  }

  locks(): readonly LockEntry[] | null {
    return null;
  }

  fileKey(): string | null {
    return null;
  }

  unixListeners(): readonly UnixListener[] | null {
    return null;
  }

  pidNamespace(): string | null {
    return null;
  }

  host(): HostReading {
    const load = this.#os.loadavg();
    const memTotal = this.#os.totalmem();
    const used = usedMemory(this.#run("vm_stat", []));
    const swap = swapUsage(this.#run("sysctl", ["-n", "vm.swapusage"]));
    return {
      load:
        load.length === 3 && load.every(Number.isFinite)
          ? [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0]
          : null,
      cpuPressure: null,
      memoryPressure: null,
      memTotal,
      memAvailable: used === null ? null : Math.max(0, memTotal - used),
      swapTotal: swap?.total ?? null,
      swapUsed: swap?.used ?? null,
      cpuTime: cpuTime(this.#os.cpus()),
      cpus: this.#os.availableParallelism(),
    };
  }

  /**
   * Rows by pid; a line that does not parse (a header, a cut line, a `-`
   * value) is left out. A `ps` that failed throws: no table is no snapshot
   * (D1's exit 3), never a host without daemons (`reviews/wave-2.md` B4).
   */
  #read(): ReadonlyMap<number, PsLine> {
    const output = this.#run("env", PS);
    if (output === null)
      throw new Error("the process table cannot be read: ps failed, is missing or timed out");
    const lines = new Map<number, PsLine>();
    for (const text of output.split("\n")) {
      const line = this.#line(text);
      if (line !== null) lines.set(line.row.pid, line);
    }
    return lines;
  }

  #line(text: string): PsLine | null {
    const m = ROW.exec(text);
    if (m === null) return null;
    const [
      ,
      pid,
      ppid,
      pgid,
      uid,
      nice,
      time = "",
      rss,
      month = "",
      day,
      h,
      min,
      s,
      year,
      command = "",
    ] = m;
    const cpuTicks = ticksOf(time);
    const start = localTime(Number(year), month, Number(day), [h, min, s].map(Number));
    if (cpuTicks === null || start === null) return null;
    // `command` joins the arguments with spaces: one that holds a space reads as two.
    const args = command === "" ? null : command.split(" ");
    return {
      row: {
        pid: Number(pid),
        ppid: Number(ppid),
        pgid: Number(pgid),
        comm: basename(args?.[0] ?? ""),
        state: null,
        startTicks: Math.round(((start - (this.#boot ?? 0)) * CLOCK_TICKS) / 1000),
        cpuTicks,
        // `time=` is the process's own; `-S`, which adds the children's, would hide it.
        childTicks: null,
        nice: Number(nice),
        uid: Number(uid),
      },
      args,
      rssBytes: Number(rss) * 1024,
    };
  }
}

/** CPU time of `time=` in hundredths of a second; `null` for `-` or anything else. */
function ticksOf(time: string): number | null {
  const m = TIME.exec(time);
  if (m === null) return null;
  const [, days = "0", hours = "0", minutes = "0", seconds = "0", fraction = "0"] = m;
  const total = ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds);
  return total * CLOCK_TICKS + Math.round(Number(`0.${fraction}`) * CLOCK_TICKS);
}

/** `lstart`'s fields in the local time zone, which `ps` and Node share; `null` for no such day. */
function localTime(year: number, month: string, day: number, time: number[]): EpochMs | null {
  const index = MONTHS.indexOf(month);
  const [hours = 0, minutes = 0, seconds = 0] = time;
  const date = new Date(year, index, day, hours, minutes, seconds);
  return index < 0 || date.getDate() !== day || date.getMonth() !== index ? null : date.getTime();
}

/** Activity Monitor's used memory: app (anonymous less purgeable), wired and compressed pages. */
function usedMemory(text: string | null): number | null {
  const pageSize = /page size of (\d+) bytes/.exec(text ?? "")?.[1];
  const pages = new Map<string, number>();
  for (const m of (text ?? "").matchAll(/^([^:\n]+):\s+(\d+)\.$/gm))
    pages.set(m[1] ?? "", Number(m[2]));
  const counts = [
    "Anonymous pages",
    "Pages purgeable",
    "Pages wired down",
    "Pages occupied by compressor",
  ].map((name) => pages.get(name));
  const [anonymous, purgeable, wired, compressed] = counts;
  if (pageSize === undefined || counts.some((n) => n === undefined)) return null;
  return (
    ((anonymous ?? 0) - (purgeable ?? 0) + (wired ?? 0) + (compressed ?? 0)) * Number(pageSize)
  );
}

/** `total = 2048.00M  used = 1385.25M  free = 662.75M  (encrypted)`, in bytes. */
function swapUsage(text: string | null): { total: number; used: number } | null {
  const bytes = (name: string): number | null => {
    const m = new RegExp(`\\b${name} = ([\\d.]+)([KMG])`).exec(text ?? "");
    if (m === null) return null;
    return Number(m[1]) * 1024 ** ("KMG".indexOf(m[2] ?? "") + 1);
  };
  const total = bytes("total");
  const used = bytes("used");
  return total === null || used === null ? null : { total, used };
}

/** Every CPU's times summed, in clock ticks as `CpuTimes` counts. */
function cpuTime(cpus: readonly { readonly times: CpuInfo["times"] }[]): CpuTimes | null {
  if (cpus.length === 0) return null;
  let busy = 0;
  let total = 0;
  for (const { times } of cpus) {
    busy += times.user + times.nice + times.sys + times.irq;
    total += times.user + times.nice + times.sys + times.irq + times.idle;
  }
  return { busy: (busy * CLOCK_TICKS) / 1000, total: (total * CLOCK_TICKS) / 1000 };
}
