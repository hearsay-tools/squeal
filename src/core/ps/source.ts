import { execFileSync } from "node:child_process";
import type { EpochMs } from "../types/index.js";

/*
 * Spec 014 D11: the one interface every `squeal ps` stage reads the host
 * through. `proc.ts` implements it over `/proc` on Linux (D2 to D6), and the
 * macOS source over `ps`, `vm_stat` and `sysctl` (D10). Every read is
 * synchronous and serial (D4). No read throws: a process that left between
 * two reads, a file of another user and a file the platform does not have
 * all read as absent or `null`, and the stage that needed the value names it
 * in the snapshot's `unknown` (D8). Nothing here writes, signals or connects.
 */

export type PsPlatform = "linux" | "darwin";

/** What `memory` measures: `RssAnon + RssShmem` on Linux (D4), RSS on macOS (D10). */
export type MemoryKind = "private" | "rss";

/** One process of one table read: on Linux, the fields of its `/proc/<pid>/stat` (D2, D4, D5). */
export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  /** The command name: `MainThread` for Node 24's main thread, `node`, `git`, ... */
  readonly comm: string;
  /** `R`, `S`, `T`, `Z`, ...; `null` where the platform does not give it. */
  readonly state: string | null;
  /** When it started, in clock ticks after boot (`stat` field 22): with the pid, its identity. */
  readonly startTicks: number;
  /** User plus system CPU it used, in clock ticks (`stat` fields 14 and 15). */
  readonly cpuTicks: number;
  /**
   * User plus system CPU of the children it waited for, in clock ticks
   * (`stat` fields 16 and 17, `cutime + cstime`): a child that ended adds its
   * whole life, its own waited-for children's included. `null` where the
   * platform does not give it (D10).
   */
  readonly childTicks: number | null;
  /** `stat` field 19. */
  readonly nice: number;
  /** Its owner; `null` when it cannot be read. */
  readonly uid: number | null;
}

/** Rows by pid. A process that left during the read is not in it. */
export type ProcessTable = ReadonlyMap<number, ProcessRow>;

export interface ProcessMemory {
  /** `RssAnon + RssShmem` in bytes on Linux; RSS on macOS (`PsSource.memoryKind`). */
  readonly bytes: number;
  /** `VmSwap` in bytes; `null` where it cannot be read (macOS). */
  readonly swapBytes: number | null;
}

/** One line of `/proc/locks`. */
export interface LockEntry {
  /** `POSIX`, `FLOCK`, `OFDLCK`, `LEASE`, ... */
  readonly kind: string;
  readonly access: "read" | "write";
  /** `null` for an open file description lock, which no process owns (`-1`). */
  readonly pid: number | null;
  /** The locked file as `fileKey` gives it: `<major>:<minor>:<inode>`, the device in hex. */
  readonly file: string;
  /** A request waiting behind a held lock (`->`), not a held lock. */
  readonly blocked: boolean;
}

/**
 * One listening unix socket of `ss -xle` (D2 step 4), by the VFS inode of
 * its file, which `stat` of the renamed file gives: the name it was bound
 * at is a staging name, before the daemon renamed it into place.
 */
export interface UnixListener {
  readonly fileInode: number;
}

/** CPU time of every CPU since boot. Only the difference of two readings means something (D6). */
export interface CpuTimes {
  /** Everything but idle and I/O wait. */
  readonly busy: number;
  readonly total: number;
}

/** The host files of one read (D6). A value the platform does not give is `null`. */
export interface HostReading {
  /** 1, 5 and 15 minute load averages. */
  readonly load: readonly [number, number, number] | null;
  /** `/proc/pressure/cpu` `some avg10`, in percent. */
  readonly cpuPressure: number | null;
  /** `/proc/pressure/memory` `some` and `full avg10`, in percent. */
  readonly memoryPressure: { readonly some: number; readonly full: number } | null;
  /** Bytes. `MemTotal` changes, so it is read every time (`research/process-measurement.md` 4). */
  readonly memTotal: number | null;
  readonly memAvailable: number | null;
  readonly swapTotal: number | null;
  readonly swapUsed: number | null;
  readonly cpuTime: CpuTimes | null;
  /** `os.availableParallelism()`, which follows the CPU affinity and a cgroup's `cpu.max`. */
  readonly cpus: number;
}

/**
 * Runs a command and returns its standard output; `null` when it is missing,
 * fails or times out. Synchronous, since every read is (D4).
 */
export type CommandRunner = (command: string, args: readonly string[]) => string | null;

export interface PsSource {
  readonly platform: PsPlatform;
  readonly memoryKind: MemoryKind;
  /** Whether `markOf` reads marks at all. When not, a lane is `null` and an escaped process has no owner (D10). */
  readonly readsMarks: boolean;
  /** Ticks per second of `startTicks`, `cpuTicks` and `childTicks`. */
  clockTicks(): number;
  /** When the host booted; `null` when it cannot be read. */
  bootTime(): EpochMs | null;
  /**
   * Every process, or only `pids`. One `stat` scan on Linux (D2 step 1).
   * With `since`, also each process whose pid `since` does not hold: one
   * born after that read (D4). A pid reused since then is not found.
   */
  processTable(pids?: readonly number[], since?: ProcessTable): ProcessTable;
  /** Its arguments; `null` when it left or they cannot be read. */
  cmdline(pid: number): readonly string[] | null;
  /**
   * Its `SQUEAL_DAEMON_CHILD` value (D5): `<token>`, `<token>:<lane>` or
   * `<token>:<lane>#<runId>`. `null` when it has none, left, or its
   * environment cannot be read, as another user's cannot. It never returns,
   * keeps or logs any other environment value.
   */
  markOf(pid: number): string | null;
  /** `null` when it left, has no memory of its own (a kernel thread) or cannot be read. */
  memory(pid: number): ProcessMemory | null;
  /** The targets of its open file descriptors: paths, `socket:[<inode>]`, ...; `null` when unreadable (D2 step 2). */
  fds(pid: number): readonly string[] | null;
  /** Every lock of `/proc/locks`; `null` without it (D2 step 3, D6). */
  locks(): readonly LockEntry[] | null;
  /** The key `locks` names `path` by; `null` when it is missing or the platform has no locks. */
  fileKey(path: string): string | null;
  /** Every listening unix socket; `null` without `ss` (D2 step 4). */
  unixListeners(): readonly UnixListener[] | null;
  /** The PID namespace pids mean something in, as a consumer's harness process records it; `null` without one. */
  pidNamespace(): string | null;
  host(): HostReading;
}

/** Ticks of `clockTicks` per second as milliseconds. */
export function ticksToMs(ticks: number, clockTicks: number): number {
  return (ticks * 1000) / clockTicks;
}

/** The default `CommandRunner`: no shell, no input, stderr dropped, 2 s at most. */
export const runCommand: CommandRunner = (command, args) => {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return null;
  }
};
