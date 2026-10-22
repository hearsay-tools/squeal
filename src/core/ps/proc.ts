import { readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { CHILD_VARIABLE } from "../daemon/escaped.js";
import { TICKS_PER_SECOND } from "../daemon/terminate.js";
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
 * Spec 014 D11: the Linux source. It reads `/proc` under `root`, which tests
 * replace with a fixture tree, and runs only `ss -xle`. Reads are
 * synchronous and serial (D4: through the libuv pool they cost 3 to 8 times
 * the CPU). A file that cannot be read is a process that left, another
 * user's or one this kernel does not have: it reads as absent or `null`.
 */

export interface ProcSourceOptions {
  /** The directory `proc` lies in: `/` but in tests. */
  readonly root?: string;
  readonly availableParallelism?: () => number;
  /** Runs `ss -xle` (D2 step 4). */
  readonly run?: CommandRunner;
}

/** The only environment entry `markOf` reads (D5). */
const MARK = Buffer.from(`${CHILD_VARIABLE}=`);

export function createProcSource(options: ProcSourceOptions = {}): PsSource {
  return new ProcSource(options);
}

class ProcSource implements PsSource {
  readonly platform = "linux";
  readonly memoryKind: MemoryKind = "private";
  readonly readsMarks = true;
  readonly #proc: string;
  readonly #cpus: () => number;
  readonly #run: CommandRunner;

  constructor(options: ProcSourceOptions) {
    this.#proc = join(options.root ?? "/", "proc");
    this.#cpus = options.availableParallelism ?? availableParallelism;
    this.#run = options.run ?? runCommand;
  }

  clockTicks(): number {
    return TICKS_PER_SECOND;
  }

  bootTime(): EpochMs | null {
    const seconds = /^btime (\d+)$/m.exec(this.#read("stat") ?? "")?.[1];
    return seconds === undefined ? null : Number(seconds) * 1000;
  }

  processTable(pids?: readonly number[], since?: ProcessTable): ProcessTable {
    const table = new Map<number, ProcessRow>();
    const born = since === undefined ? [] : this.#pids().filter((pid) => !since.has(pid));
    for (const pid of pids === undefined ? this.#pids() : new Set([...pids, ...born])) {
      const row = this.#row(pid);
      if (row !== null) table.set(pid, row);
    }
    return table;
  }

  cmdline(pid: number): readonly string[] | null {
    const text = this.#read(`${pid}/cmdline`);
    if (text === null) return null;
    const args = text.split("\0");
    if (args.at(-1) === "") args.pop();
    return args;
  }

  markOf(pid: number): string | null {
    const bytes = this.#bytes(`${pid}/environ`);
    if (bytes === null) return null;
    for (let at = bytes.indexOf(MARK); at >= 0; at = bytes.indexOf(MARK, at + 1)) {
      if (at > 0 && bytes[at - 1] !== 0) continue;
      const start = at + MARK.length;
      const end = bytes.indexOf(0, start);
      return bytes.toString("utf8", start, end < 0 ? bytes.length : end);
    }
    return null;
  }

  memory(pid: number): ProcessMemory | null {
    const status = kilobytes(this.#read(`${pid}/status`));
    const anon = status.get("RssAnon");
    const shmem = status.get("RssShmem");
    if (anon === undefined || shmem === undefined) return null;
    const swap = status.get("VmSwap");
    return { bytes: anon + shmem, swapBytes: swap ?? null };
  }

  fds(pid: number): readonly string[] | null {
    const dir = join(this.#proc, String(pid), "fd");
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return null;
    }
    const targets: string[] = [];
    for (const fd of names
      .filter(isPid)
      .map(Number)
      .sort((a, b) => a - b)) {
      // An fd closed between the listing and its link is no longer open: it is left out.
      const target = this.#link(`${pid}/fd/${fd}`);
      if (target !== null) targets.push(target);
    }
    return targets;
  }

  locks(): readonly LockEntry[] | null {
    const text = this.#read("locks");
    if (text === null) return null;
    const locks: LockEntry[] = [];
    for (const line of text.split("\n")) {
      const m =
        /^\s*\d+:\s+((?:->\s*)+)?(\S+)\s+\S+\s+(READ|WRITE)\s+(-?\d+)\s+([0-9a-f]+):([0-9a-f]+):(\d+)\s/i.exec(
          line,
        );
      if (m === null) continue;
      const [, arrow, kind = "", access = "", pid = "", major = "", minor = "", inode = ""] = m;
      locks.push({
        kind,
        access: access.toUpperCase() === "WRITE" ? "write" : "read",
        pid: Number(pid) > 0 ? Number(pid) : null,
        file: `${hex(BigInt(`0x${major}`))}:${hex(BigInt(`0x${minor}`))}:${inode}`,
        blocked: arrow !== undefined,
      });
    }
    return locks;
  }

  fileKey(path: string): string | null {
    let dev: bigint;
    let ino: bigint;
    try {
      ({ dev, ino } = statSync(path, { bigint: true }));
    } catch {
      return null;
    }
    // glibc's `major` and `minor` of the `st_dev` Node gives (sys/sysmacros.h).
    const major = ((dev & 0xfff00n) >> 8n) | ((dev & 0xfffff00000000000n) >> 32n);
    const minor = (dev & 0xffn) | ((dev & 0xffffff00000n) >> 12n);
    return `${hex(major)}:${hex(minor)}:${ino}`;
  }

  unixListeners(): readonly UnixListener[] | null {
    const text = this.#run("ss", ["-xle"]);
    if (text === null) return null;
    const listeners: UnixListener[] = [];
    for (const line of text.split("\n")) {
      // `u_str LISTEN <recv-q> <send-q> <bound name> <socket inode> * 0 ... ino:<file inode>`.
      const m = /^u_\w+\s+LISTEN\s+\d+\s+\d+\s+.+?\s+\d+\s+\*\s+\d+\b.*?\bino:(\d+)\b/.exec(line);
      if (m !== null) listeners.push({ fileInode: Number(m[1]) });
    }
    return listeners;
  }

  pidNamespace(): string | null {
    return this.#link("self/ns/pid");
  }

  host(): HostReading {
    const load = (this.#read("loadavg") ?? "").split(" ").slice(0, 3).map(Number);
    const cpu = pressure(this.#read("pressure/cpu"));
    const memory = pressure(this.#read("pressure/memory"));
    const meminfo = kilobytes(this.#read("meminfo"));
    const swapTotal = meminfo.get("SwapTotal") ?? null;
    const swapFree = meminfo.get("SwapFree");
    return {
      load:
        load.length === 3 && load.every(Number.isFinite)
          ? [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0]
          : null,
      cpuPressure: cpu.get("some") ?? null,
      memoryPressure:
        memory.has("some") && memory.has("full")
          ? { some: memory.get("some") ?? 0, full: memory.get("full") ?? 0 }
          : null,
      memTotal: meminfo.get("MemTotal") ?? null,
      memAvailable: meminfo.get("MemAvailable") ?? null,
      swapTotal,
      swapUsed: swapTotal !== null && swapFree !== undefined ? swapTotal - swapFree : null,
      cpuTime: cpuTime(this.#read("stat")),
      cpus: this.#cpus(),
    };
  }

  #pids(): number[] {
    try {
      return readdirSync(this.#proc).filter(isPid).map(Number);
    } catch {
      return [];
    }
  }

  /** Fields are counted after the last `)`, since the command name may hold spaces and parentheses. */
  #row(pid: number): ProcessRow | null {
    const text = this.#read(`${pid}/stat`);
    if (text === null) return null;
    const open = text.indexOf("(");
    const close = text.lastIndexOf(")");
    if (open < 0 || close < open) return null;
    const f = text.slice(close + 2).split(" ");
    const [ppid, utime, stime, cutime, cstime, nice, startTicks] = [
      f[1],
      f[11],
      f[12],
      f[13],
      f[14],
      f[16],
      f[19],
    ].map(Number);
    const numbers = [ppid, utime, stime, cutime, cstime, nice, startTicks];
    if (!numbers.every(Number.isInteger)) return null;
    return {
      pid,
      ppid: ppid ?? 0,
      comm: text.slice(open + 1, close),
      state: f[0] ?? null,
      startTicks: startTicks ?? 0,
      cpuTicks: (utime ?? 0) + (stime ?? 0),
      childTicks: (cutime ?? 0) + (cstime ?? 0),
      nice: nice ?? 0,
      uid: this.#uid(pid),
    };
  }

  #uid(pid: number): number | null {
    try {
      return statSync(join(this.#proc, String(pid))).uid;
    } catch {
      return null;
    }
  }

  #read(path: string): string | null {
    try {
      return readFileSync(join(this.#proc, path), "utf8");
    } catch {
      return null;
    }
  }

  #bytes(path: string): Buffer | null {
    try {
      return readFileSync(join(this.#proc, path));
    } catch {
      return null;
    }
  }

  #link(path: string): string | null {
    try {
      return readlinkSync(join(this.#proc, path));
    } catch {
      return null;
    }
  }
}

function isPid(name: string): boolean {
  return /^\d+$/.test(name);
}

function hex(n: bigint): string {
  return n.toString(16).padStart(2, "0");
}

/** The `<name>: <n> kB` lines of `status` or `meminfo`, in bytes. */
function kilobytes(text: string | null): Map<string, number> {
  const values = new Map<string, number>();
  for (const m of (text ?? "").matchAll(/^(\w+):\s+(\d+) kB$/gm))
    values.set(m[1] ?? "", Number(m[2]) * 1024);
  return values;
}

/** `avg10` of each line of a `/proc/pressure` file, by its kind (`some`, `full`). */
function pressure(text: string | null): Map<string, number> {
  const values = new Map<string, number>();
  for (const m of (text ?? "").matchAll(/^(\w+) avg10=([\d.]+)/gm))
    values.set(m[1] ?? "", Number(m[2]));
  return values;
}

/** The first line of `/proc/stat`: user, nice, system, idle, iowait, irq, softirq, steal. */
function cpuTime(text: string | null): CpuTimes | null {
  const line = /^cpu\s+(.*)$/m.exec(text ?? "")?.[1];
  if (line === undefined) return null;
  const ticks = line.trim().split(/\s+/).slice(0, 8).map(Number);
  if (ticks.length < 5 || !ticks.every(Number.isFinite)) return null;
  const total = ticks.reduce((a, b) => a + b, 0);
  return { busy: total - (ticks[3] ?? 0) - (ticks[4] ?? 0), total };
}
