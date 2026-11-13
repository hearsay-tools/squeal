import { vi } from "vitest";
import { type GcFunction, IdleGc, type IdleGcOptions } from "../../src/core/daemon/idle-gc.js";

/*
 * The idle and busy GC's test subject (rows 011-69 and 021-29): a test
 * clock, a test heap reading, a private memory reading of 900 MiB before
 * each GC and 500 MiB after it, and a recording `gc` that lowers the heap
 * in use to `heap.live`. What `IdleGc` defers waits in `deferred` until
 * the test calls `flush`, as it would for the event loop's next turn.
 */

export const LAST_RESORT = { type: "major", execution: "sync", flavor: "last-resort" };
export const MIB = 2 ** 20;

export interface Subject {
  readonly idle: IdleGc;
  readonly gc: ReturnType<typeof vi.fn<GcFunction>>;
  /** The test clock at each `gc` call. */
  readonly gcAt: number[];
  /** Heap in use as `IdleGc` reads it, and what a `gc` call leaves; 100 MiB each to start. */
  readonly heap: { now: number; live: number };
  readonly notes: string[];
  readonly lines: string[];
  /** What `IdleGc` deferred, not yet run; `flush` runs it, as the event loop would. */
  readonly deferred: (() => void)[];
  /** The daemon stops: `IdleGc`'s `stopping` reads this. */
  readonly daemon: { stopping: boolean };
  now(): number;
  advance(ms: number): void;
  /** Runs what `IdleGc` deferred, in order. */
  flush(): void;
}

export function subject(options: Partial<IdleGcOptions> = {}): Subject {
  let clock = 1_000_000;
  const heap = { now: 100 * MIB, live: 100 * MIB };
  const gcAt: number[] = [];
  const gc = vi.fn<GcFunction>(() => {
    heap.now = heap.live;
    gcAt.push(clock);
  });
  const notes: string[] = [];
  const lines: string[] = [];
  let reading = 0;
  const deferred: (() => void)[] = [];
  const daemon = { stopping: false };
  const idle = new IdleGc({
    now: () => clock,
    note: (text) => notes.push(text),
    log: (line) => lines.push(line),
    lookup: () => gc,
    // 900 MiB before each GC, 500 MiB after it.
    memory: () => ({ kind: "private", bytes: (reading++ % 2 === 0 ? 900 : 500) * MIB }),
    heapInUse: () => heap.now,
    defer: (run) => deferred.push(run),
    stopping: () => daemon.stopping,
    ...options,
  });
  return {
    idle,
    gc,
    gcAt,
    heap,
    notes,
    lines,
    deferred,
    daemon,
    now: () => clock,
    advance: (ms) => {
      clock += ms;
    },
    flush: () => {
      for (const run of deferred.splice(0)) run();
    },
  };
}

/** A tier that runs `ms` on the test clock. */
export function tier(t: Subject, ms = 1_000): void {
  t.idle.started();
  t.advance(ms);
  t.idle.ended();
}
