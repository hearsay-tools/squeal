import type { Measure, ProcessCost, TakeSample } from "./model.js";
import { ticksToMs } from "./source.js";

/*
 * Spec 014 D4 (task 014-07): what each process costs. The CPU is the
 * difference of two samples' ticks over the time between them, in percent
 * of one CPU; a pool thread's ticks are its process's. A process is the
 * same in both samples when its pid and start ticks match; one seen once
 * has no window CPU (`null`), never 0, and never a lifetime percent. Its
 * cumulative CPU time is that of its last sample. The memory is the
 * source's (`RssAnon + RssShmem` and `VmSwap` on Linux), read after the
 * second sample for the processes still in it, so `Measure`'s reads are
 * those the cost bound counts outside the window.
 */

/** One table read and the host's CPU times, at the middle of the read on a monotonic clock. */
export const takeSample: TakeSample = (source, pids) => {
  const before = performance.now();
  const table = source.processTable(pids);
  const cpuTime = source.host().cpuTime;
  return { atMs: (before + performance.now()) / 2, table, cpuTime };
};

export const measure: Measure = (source, first, second, pids) => {
  const windowMs = second.atMs - first.atMs;
  const clockTicks = source.clockTicks();
  const costs = new Map<number, ProcessCost>();
  for (const pid of pids) {
    const before = first.table.get(pid);
    const after = second.table.get(pid);
    // A pid another process took during the window: the first one left at it.
    const now = before === undefined || after?.startTicks === before.startTicks ? after : undefined;
    const last = now ?? before;
    if (last === undefined) continue;
    const ticks = before !== undefined && now !== undefined ? now.cpuTicks - before.cpuTicks : null;
    const memory = now === undefined ? null : source.memory(pid);
    costs.set(pid, {
      cpuPct:
        ticks === null || ticks < 0 || windowMs <= 0
          ? null
          : (ticksToMs(ticks, clockTicks) / windowMs) * 100,
      cpuMs: ticksToMs(last.cpuTicks, clockTicks),
      privateBytes: memory?.bytes ?? null,
      swapBytes: memory?.swapBytes ?? null,
    });
  }
  return costs;
};

/**
 * D4 "Totals sum the same two values": each value sums the processes that
 * have one, and is `null` only when some process has none and no process
 * has one. A process seen once adds its CPU time but no window CPU.
 */
export function sumCosts(costs: readonly ProcessCost[]): ProcessCost {
  const sum = (values: readonly (number | null)[]): number | null => {
    const known = values.filter((v): v is number => v !== null);
    return known.length === 0 && values.length > 0 ? null : known.reduce((a, b) => a + b, 0);
  };
  return {
    cpuPct: sum(costs.map((c) => c.cpuPct)),
    cpuMs: costs.reduce((a, c) => a + c.cpuMs, 0),
    privateBytes: sum(costs.map((c) => c.privateBytes)),
    swapBytes: sum(costs.map((c) => c.swapBytes)),
  };
}
