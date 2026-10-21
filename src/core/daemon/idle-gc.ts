import { readFileSync } from "node:fs";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import type { EpochMs, RunnerAdapter } from "../types/index.js";

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
}

/**
 * The daemon's last-resort GC once it is idle (spec 011 C9, row 011-69;
 * research `daemon-memory.md` 2 and 4). A plain full GC frees the heap but
 * V8 keeps the pages: on a cezar clone private memory fell 0 to 7 MiB. The
 * last-resort flavor gives them back: 791 to 486 MiB in a 154 to 234 ms
 * pause. Not after each tier: the next tier regrows the space at once.
 *
 * Every run of the runner `track` wraps is a tier. The daemon calls `ready`
 * once its start scan is done, and the lifecycle check loop calls `check`.
 * Kept by the daemon, so a policy reload that restarts the timers keeps it.
 */
export class IdleGc {
  readonly #options: IdleGcOptions;
  #running = 0;
  #quietSince: EpochMs | null = null;
  #collected = false;
  /** Looked up at the first GC; `null` once it was missing or threw, and noted. */
  #gc: GcFunction | null | undefined;

  constructor(options: IdleGcOptions) {
    this.#options = options;
  }

  /** The start scan is done: with no tier in flight, the quiet counts from here. */
  ready(): void {
    if (this.#running === 0) this.#quietSince = this.#options.now();
  }

  started(): void {
    this.#running += 1;
  }

  ended(): void {
    this.#running = Math.max(0, this.#running - 1);
    this.#quietSince = this.#options.now();
    this.#collected = false;
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

  /** Runs the GC when it is due. Never throws. */
  check(): void {
    if (this.#gc === null) return;
    const due = idleGcDue({
      now: this.#options.now(),
      quietSince: this.#quietSince,
      tierRunning: this.#running > 0,
      collected: this.#collected,
    });
    if (!due) return;
    this.#collected = true;
    const gc = this.#gc ?? this.#lookup();
    if (gc === null) return;
    const memory = this.#options.memory ?? readMemory;
    const before = memory();
    const start = performance.now();
    try {
      gc(LAST_RESORT);
    } catch (error) {
      this.#off(`it failed (${String(error)})`);
      return;
    }
    const pause = Math.round(performance.now() - start);
    const after = memory();
    const what = before.kind === "private" ? "private memory" : "RSS";
    this.#options.log(
      `no tier for ${IDLE_GC_AFTER_MS / 1000} s: a last-resort GC took ${what} ` +
        `from ${mib(before.bytes)} to ${mib(after.bytes)} MiB in a ${pause} ms pause`,
    );
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
    this.#options.note(`no last-resort GC when idle: ${why}; this daemon runs on without it`);
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

const mib = (bytes: number) => Math.round(bytes / 2 ** 20);
