import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { measure } from "../ps/measure.js";
import type { Sample } from "../ps/model.js";
import { createProcSource } from "../ps/proc.js";
import { type PsSource, ticksToMs } from "../ps/source.js";
import type { PoolMark } from "./marks.js";

/*
 * 011 C10 Size as amended 2026-10-21 (design 011-83 Q3 (a), row 011-98):
 * each daemon with a tier running measures the CPU its process tree used
 * since its last mark refresh: its own, its test processes', what they
 * started, and the children they reaped. The arithmetic is `squeal ps`'s
 * (014-21's `measure`, with the daemon as its only row), so a child that
 * ended between two reads counts through its parent's children's times.
 * Each read lists the tree from the daemon down through the children files
 * of its processes' threads, as the priority walk does (`low-priority.ts`),
 * and reads only those processes. A process re-parented out of the tree is
 * not measured. Beside each read the pool reads the host's busy cores from
 * `/proc/stat` over the same window, `%nice` included, so a backlog tier
 * sees the host's other work too (011 C10 Size as amended 2026-10-24, row
 * 011-182).
 */

export interface TreeCpuOptions {
  /** The tree's root, the daemon. Default this process. */
  readonly pid?: number;
  /** The directory `proc` lies in: `/` but in tests. */
  readonly root?: string;
  /** A monotonic clock in ms. Default `performance.now`. */
  readonly now?: () => number;
}

/** What one daemon's process tree used, read at each mark refresh. */
export interface TreeCpu {
  /**
   * The cores the tree used since the last read, `null` at the first read
   * after `reset` or when the daemon's own process cannot be read.
   */
  read(): number | null;
  /** The next read starts a window. */
  reset(): void;
}

/** The host's CPU, read beside a daemon's tree over the same window (row 011-182). */
export interface HostCpu {
  /**
   * The cores the host's CPUs were busy since the last read, `%nice`
   * included: all but idle and iowait. `null` at the first read, or when
   * the host's CPU times cannot be read.
   */
  read(): number | null;
}

/**
 * How many of `want` permits a daemon may take under the CPU gate (011 C10
 * Size, row 011-98): each needs the fresh marks' cores, its own and each
 * permit taken before it included, below `hostSlots`, or the marks' grants
 * below half of them. A mark without cores counts its grant, and a permit
 * not yet measured one core. So the backlog shrinks toward half the slots
 * while Squeal's tests use more CPU than the slots, and always moves. A
 * backlog tier's cores start at `busy`, the host's busy cores, when they are
 * more (011 C10 Size as amended 2026-10-24, row 011-182): on a host busy
 * with other work it takes a permit only while the grants are below half
 * the slots. `null`, any other tier's or an unread host's, adds nothing.
 */
export function gatedPermits(
  marks: readonly PoolMark[],
  own: { readonly cores: number; readonly grant: number },
  hostSlots: number,
  want: number,
  busy: number | null = null,
): number {
  const marked = marks.reduce((sum, m) => sum + (m.cores ?? m.grant), own.cores);
  let cores = Math.max(marked, busy ?? 0);
  let grants = marks.reduce((sum, m) => sum + m.grant, own.grant);
  let taken = 0;
  for (; taken < want && (cores < hostSlots || grants < hostSlots / 2); taken++) {
    cores++;
    grants++;
  }
  return taken;
}

/** The tree of `options.pid`, or `null` where its process cannot be read (no `/proc`). */
export function createTreeCpu(options: TreeCpuOptions = {}): TreeCpu | null {
  const pid = options.pid ?? process.pid;
  const source = createProcSource(options.root === undefined ? {} : { root: options.root });
  if (!source.processTable([pid]).has(pid)) return null;
  return new ProcTreeCpu(pid, join(options.root ?? "/", "proc"), source, options.now);
}

/** The host's CPU under `options.root`'s `/proc/stat`, or `null` where it cannot be read. */
export function createHostCpu(options: Omit<TreeCpuOptions, "pid"> = {}): HostCpu | null {
  const source = createProcSource(options.root === undefined ? {} : { root: options.root });
  if (source.host().cpuTime === null) return null;
  return new ProcHostCpu(source, options.now);
}

class ProcHostCpu implements HostCpu {
  readonly #source: PsSource;
  readonly #now: () => number;
  #last: { readonly atMs: number; readonly busy: number } | null = null;

  constructor(source: PsSource, now = () => performance.now()) {
    this.#source = source;
    this.#now = now;
  }

  read(): number | null {
    const busy = this.#source.host().cpuTime?.busy;
    const atMs = this.#now();
    const last = this.#last;
    this.#last = busy === undefined ? null : { atMs, busy };
    if (last === null || this.#last === null || atMs <= last.atMs) return null;
    return ticksToMs(this.#last.busy - last.busy, this.#source.clockTicks()) / (atMs - last.atMs);
  }
}

class ProcTreeCpu implements TreeCpu {
  readonly #pid: number;
  readonly #proc: string;
  readonly #source: PsSource;
  readonly #now: () => number;
  #last: Sample | null = null;

  constructor(pid: number, proc: string, source: PsSource, now = () => performance.now()) {
    this.#pid = pid;
    this.#proc = proc;
    this.#source = source;
    this.#now = now;
  }

  read(): number | null {
    const table = this.#source.processTable(this.#tree());
    const sample: Sample = { atMs: this.#now(), table, host: null };
    const last = this.#last;
    this.#last = table.has(this.#pid) ? sample : null;
    if (last === null || this.#last === null) return null;
    const cpuPct = measure(this.#source, last, sample, [this.#pid]).get(this.#pid)?.cpuPct;
    return cpuPct === undefined || cpuPct === null ? null : cpuPct / 100;
  }

  reset(): void {
    this.#last = null;
  }

  /** The daemon and every process below it now. */
  #tree(): number[] {
    const seen = new Set<number>();
    for (let queue = [this.#pid], pid = queue.pop(); pid !== undefined; pid = queue.pop()) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      queue.push(...this.#children(pid));
    }
    return [...seen];
  }

  /** `pid`'s children, from its threads' `children` files; none when it left. */
  #children(pid: number): number[] {
    let tasks: string[];
    try {
      tasks = readdirSync(join(this.#proc, String(pid), "task"));
    } catch {
      return [];
    }
    return tasks.flatMap((task) => {
      try {
        const text = readFileSync(
          join(this.#proc, String(pid), "task", task, "children"),
          "latin1",
        );
        return text.trim() === "" ? [] : text.trim().split(" ").map(Number);
      } catch {
        return [];
      }
    });
  }
}
