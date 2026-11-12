import { readFileSync } from "node:fs";
import { getHeapStatistics, setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import type { EpochMs } from "../types/common.js";
import type { RunnerAdapter } from "../types/runner.js";

/** No tier in any lane for this long, and the daemon is idle (spec 011 C9, row 011-69). */
export const IDLE_GC_AFTER_MS = 60_000;

/** V8's `gc` as `--expose-gc` gives it. Node 22 and 24 both take `flavor`. */
export type GcFunction = (options: {
  readonly type: "major";
  readonly execution: "sync";
  readonly flavor: "last-resort";
}) => void;

const LAST_RESORT = { type: "major", execution: "sync", flavor: "last-resort" } as const;

/** What the idle GC's decision reads. */
export interface IdleGcClock {
  readonly now: EpochMs;
  /** The last tier's end, or the daemon's ready time while none ran since; `null` while it starts. */
  readonly quietSince: EpochMs | null;
  /** A tier runs in some lane. */
  readonly tierRunning: boolean;
  /** An idle GC ran, or was tried, since the last tier ended. */
  readonly collected: boolean;
}

/**
 * Spec 011 C9 (row 011-69): the GC is due once no tier ran in any lane for
 * 60 s, and only once until a tier has run and ended since. Work queued and
 * waiting for a slot or for load is no tier.
 */
export function idleGcDue(clock: IdleGcClock): boolean {
  if (clock.tierRunning || clock.collected || clock.quietSince === null) return false;
  return clock.now - clock.quietSince >= IDLE_GC_AFTER_MS;
}

/** Busy, at most one GC per this long since the daemon's last GC of either kind (spec 021 D21.2). */
export const BUSY_GC_EVERY_MS = 60_000;

/** Busy, a GC once heap in use is above this many times the last live size (spec 021 D21.2). */
export const BUSY_GC_RATIO = 2;

/** What the busy GC's decision reads. */
export interface BusyGcClock {
  readonly now: EpochMs;
  /** A tier ended since the last check. */
  readonly tierEnded: boolean;
  /** The last GC's start, idle or busy; `null` while none ran. */
  readonly lastGc: EpochMs | null;
  /** V8's heap in use now, bytes. */
  readonly heapInUse: number;
  /** Heap in use after the last GC; before the first, the lowest read so far. `null` while none was read. */
  readonly live: number | null;
}

/**
 * Spec 021 D21.2 (row 021-29): a daemon with a long queue never has 60 s
 * without a tier, so it also collects after a tier ends once its heap in use
 * is above twice the last live size, at most once a minute.
 */
export function busyGcDue(clock: BusyGcClock): boolean {
  if (!clock.tierEnded || clock.live === null) return false;
  if (clock.lastGc !== null && clock.now - clock.lastGc < BUSY_GC_EVERY_MS) return false;
  return clock.heapInUse > BUSY_GC_RATIO * clock.live;
}

/** Private memory where the host reports it, RSS where it does not. */
export interface MemoryReading {
  readonly kind: "private" | "rss";
  readonly bytes: number;
}

export interface IdleGcOptions {
  readonly now: () => EpochMs;
  /** Persisted once, when no GC can run. */
  readonly note: (text: string) => void;
  /** One line per GC. */
  readonly log: (line: string) => void;
  /** Default `exposeGc`. May throw: noted as a missing `gc`. */
  readonly lookup?: () => GcFunction | null;
  /** Default `readMemory`. */
  readonly memory?: () => MemoryReading;
  /** V8's heap in use, bytes, for the busy GC (row 021-29). Default `readHeapInUse`. */
  readonly heapInUse?: () => number;
}

/**
 * The daemon's last-resort GC once it is idle (spec 011 C9, row 011-69;
 * research `daemon-memory.md` 2 and 4). A plain full GC frees the heap but
 * V8 keeps the pages: on a cezar clone private memory fell 0 to 7 MiB. The
 * last-resort flavor gives them back: 791 to 486 MiB in a 154 to 234 ms
 * pause. Not after each tier: the next tier regrows the space at once.
 *
 * A busy daemon also runs it after a tier ends (spec 021 D21.2, row 021-29;
 * research `021/daemon-heap.md` 1): while a queue drains, V8 keeps two to
 * three times the live heap, and the idle GC's 60 s quiet never comes. One
 * such GC took a busy daemon from 1,181 to 722 MiB in 186 ms. The live size
 * is the heap in use after the last GC, idle or busy; before the first, the
 * lowest heap in use read at ready and at the checks after tiers, so a low
 * guess costs one GC at most. The idle trigger does not change: a busy GC
 * neither stands for nor holds back the idle one.
 *
 * Every run of the runner `track` wraps is a tier. The daemon calls `ready`
 * once its start scan is done, and the lifecycle check loop calls `check`,
 * so a busy GC runs at the first check after a tier, off the tier's own path.
 * Kept by the daemon, so a policy reload that restarts the timers keeps it.
 */
export class IdleGc {
  readonly #options: IdleGcOptions;
  #running = 0;
  #quietSince: EpochMs | null = null;
  #collected = false;
  /** A tier ended since the last check: the busy GC is considered then only. */
  #tierEnded = false;
  /** The last GC's start, idle or busy. */
  #lastGc: EpochMs | null = null;
  /** Heap in use after the last GC; before the first, the lowest read so far. */
  #live: number | null = null;
  /** Looked up at the first GC; `null` once it was missing or threw, and noted. */
  #gc: GcFunction | null | undefined;

  constructor(options: IdleGcOptions) {
    this.#options = options;
  }

  /** The start scan is done: with no tier in flight, the quiet counts from here. */
  ready(): void {
    if (this.#running === 0) this.#quietSince = this.#options.now();
    if (this.#lastGc === null) this.#lowest(this.#heapInUse());
  }

  started(): void {
    this.#running += 1;
  }

  ended(): void {
    this.#running = Math.max(0, this.#running - 1);
    this.#quietSince = this.#options.now();
    this.#collected = false;
    this.#tierEnded = true;
  }

  /** `runner`, each of whose runs counts as a tier to its end. `runner` is a plain object. */
  track(runner: RunnerAdapter): RunnerAdapter {
    return {
      ...runner,
      run: async (testFiles, options) => {
        this.started();
        try {
          return await runner.run(testFiles, options);
        } finally {
          this.ended();
        }
      },
    };
  }

  /** Runs the GC when it is due, idle or busy. Never throws. */
  check(): void {
    if (this.#gc === null) return;
    const now = this.#options.now();
    const tierEnded = this.#tierEnded;
    this.#tierEnded = false;
    const idle = idleGcDue({
      now,
      quietSince: this.#quietSince,
      tierRunning: this.#running > 0,
      collected: this.#collected,
    });
    if (idle) {
      this.#collected = true;
      const took = this.#collect(now);
      if (took !== null) this.#options.log(`no tier for ${IDLE_GC_AFTER_MS / 1000} s: ${took}`);
      return;
    }
    if (!tierEnded) return;
    const heapInUse = this.#heapInUse();
    const live = this.#live;
    const busy = busyGcDue({ now, tierEnded, lastGc: this.#lastGc, heapInUse, live });
    if (this.#lastGc === null) this.#lowest(heapInUse);
    if (!busy) return;
    const took = this.#collect(now);
    if (took === null) return;
    this.#options.log(
      `busy, heap in use ${mib(heapInUse)} MiB over twice the last live size of ` +
        `${mib(live ?? 0)} MiB: ${took}; ${mib(this.#live ?? 0)} MiB of heap in use after it`,
    );
  }

  /**
   * One last-resort GC; the heap in use after it is the live size from here.
   * What it took, for the log line; `null` when no GC ran.
   */
  #collect(now: EpochMs): string | null {
    const gc = this.#gc ?? this.#lookup();
    if (gc === null) return null;
    this.#lastGc = now;
    const memory = this.#options.memory ?? readMemory;
    const before = memory();
    const start = performance.now();
    try {
      gc(LAST_RESORT);
    } catch (error) {
      this.#off(`it failed (${String(error)})`);
      return null;
    }
    const pause = Math.round(performance.now() - start);
    const after = memory();
    this.#live = this.#heapInUse();
    const what = before.kind === "private" ? "private memory" : "RSS";
    return (
      `a last-resort GC took ${what} from ${mib(before.bytes)} to ${mib(after.bytes)} MiB ` +
      `in a ${pause} ms pause`
    );
  }

  #heapInUse(): number {
    return (this.#options.heapInUse ?? readHeapInUse)();
  }

  /** Before the first GC: the live size is the lowest heap in use read so far. */
  #lowest(heapInUse: number): void {
    this.#live = this.#live === null ? heapInUse : Math.min(this.#live, heapInUse);
  }

  #lookup(): GcFunction | null {
    let reason = "";
    try {
      this.#gc = (this.#options.lookup ?? exposeGc)();
    } catch (error) {
      this.#gc = null;
      reason = ` (${String(error)})`;
    }
    if (this.#gc === null) this.#off(`V8's gc is not available${reason}`);
    return this.#gc;
  }

  #off(why: string): void {
    this.#gc = null;
    this.#options.note(`no last-resort GC: ${why}; this daemon runs on without it`);
  }
}

/**
 * V8's `gc` for this process: the global one when Node was started with
 * `--expose-gc`, else one taken from a fresh context while the flag is on.
 * The flag goes off again at once, so the contexts made later, Vitest's
 * worker threads in the daemon's process among them, see no `gc`, as under
 * `vitest run`. `null` when the fresh context has none.
 */
export function exposeGc(): GcFunction | null {
  const own: unknown = (globalThis as { gc?: unknown }).gc;
  if (typeof own === "function") return own as GcFunction;
  setFlagsFromString("--expose-gc");
  try {
    const gc: unknown = runInNewContext("typeof gc === 'function' ? gc : null");
    return typeof gc === "function" ? (gc as GcFunction) : null;
  } finally {
    setFlagsFromString("--no-expose-gc");
  }
}

/** Private memory as research 011-53 read it, `RssAnon` + `RssShmem`; RSS without `/proc`. */
export function readMemory(): MemoryReading {
  try {
    const status = readFileSync("/proc/self/status", "utf8");
    const kib = (field: string) =>
      Number(new RegExp(`^${field}:\\s+(\\d+)`, "m").exec(status)?.[1]);
    const bytes = (kib("RssAnon") + kib("RssShmem")) * 1024;
    if (Number.isFinite(bytes)) return { kind: "private", bytes };
  } catch {
    // No `/proc` (macOS): RSS below.
  }
  return { kind: "rss", bytes: process.memoryUsage.rss() };
}

/** V8's heap in use, `used_heap_size`: after a full GC, about the live size. No syscall. */
export function readHeapInUse(): number {
  return getHeapStatistics().used_heap_size;
}

const mib = (bytes: number) => Math.round(bytes / 2 ** 20);
