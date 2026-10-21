import type { CostSum, Measure, ProcessCost, TakeSample } from "./model.js";
import { type ProcessTable, ticksToMs } from "./source.js";

/*
 * Spec 014 D4 (tasks 014-07, 014-21): what each process costs. The CPU is
 * the difference of two samples' ticks over the time between them, in
 * percent of one CPU; a pool thread's ticks are its process's. A process is
 * the same in both samples when its pid and start ticks match; one seen
 * once has no window CPU (`null`), never 0, and never a lifetime percent.
 * Its cumulative CPU time is that of its last sample, its own only.
 *
 * Most of Squeal's CPU is in processes that live seconds (`lessons.md`
 * Goal 3), so a row's window CPU also holds what no row of its own holds:
 *
 * - the growth of its children's times (`cutime + cstime`): a child that
 *   started and ended in the window adds its whole life;
 * - a child that ended in the window adds its whole life there too, so the
 *   ticks it had at the first sample come off;
 * - a process born in the window adds all its ticks;
 * - a process below a row that is no row (a daemon's `git`) adds its growth.
 *
 * Each counts in the row of its nearest ancestor that lived through the
 * window. A process that ended and that no measured process waited for (an
 * escaped browser, a daemon) is left out, and `reapedBy` says so. The
 * memory is the source's (`RssAnon + RssShmem` and `VmSwap` on Linux), read
 * right after the second sample for the processes still in it: one that
 * left by then holds none (014-24).
 */

/** One table read and the host's CPU times, at the middle of the read on a monotonic clock. */
export const takeSample: TakeSample = (source, pids, since) => {
  const before = performance.now();
  const table = source.processTable(pids, since);
  const cpuTime = source.host().cpuTime;
  return { atMs: (before + performance.now()) / 2, table, cpuTime };
};

/** `pids` and every process below them in `table`: what the second sample reads again (D4). */
export function below(table: ProcessTable, pids: readonly number[]): number[] {
  const children = new Map<number, number[]>();
  for (const row of table.values())
    children.set(row.ppid, [...(children.get(row.ppid) ?? []), row.pid]);
  const all = new Set<number>();
  const next = [...pids];
  for (let pid = next.pop(); pid !== undefined; pid = next.pop()) {
    if (all.has(pid)) continue;
    all.add(pid);
    next.push(...(children.get(pid) ?? []));
  }
  return [...all];
}

export const measure: Measure = (source, first, second, pids) => {
  const windowMs = second.atMs - first.atMs;
  const clockTicks = source.clockTicks();
  const rows = new Set(pids);
  const tree = below(first.table, pids);
  const inTree = new Set(tree);
  const lived = (pid: number): boolean => {
    const before = first.table.get(pid);
    return before !== undefined && second.table.get(pid)?.startTicks === before.startTicks;
  };
  // A bound on each walk up, should a table read across a reused pid hold a cycle.
  const steps = inTree.size + second.table.size;
  /** A process of the first sample: itself or its nearest ancestor that is a row and lived through the window. */
  const homeOf = (pid: number): number | null => {
    let p: number | undefined = pid;
    for (let n = 0; p !== undefined && inTree.has(p) && n <= steps; n++) {
      if (rows.has(p) && lived(p)) return p;
      p = first.table.get(p)?.ppid;
    }
    return null;
  };
  /** A process born in the window: the home of its nearest ancestor of the first sample, or a row born too. */
  const homeAfter = (pid: number): number | null => {
    let p: number | undefined = pid;
    for (let n = 0; p !== undefined && n <= steps; n++) {
      if (lived(p)) return homeOf(p);
      const row = second.table.get(p);
      if (row === undefined) return null;
      if (rows.has(p) && !first.table.has(p)) return p;
      p = row.ppid;
    }
    return null;
  };

  const counted = new Map<number, number>();
  const count = (home: number | null, ticks: number): void => {
    if (home !== null) counted.set(home, (counted.get(home) ?? 0) + ticks);
  };
  const reapedBy = new Map<number, number | null>();
  for (const pid of tree) {
    const before = first.table.get(pid);
    if (before === undefined) continue;
    const after = second.table.get(pid);
    if (after !== undefined && after.startTicks === before.startTicks) {
      const home = homeOf(pid);
      if (!rows.has(pid)) count(home, after.cpuTicks - before.cpuTicks);
      count(home, (after.childTicks ?? 0) - (before.childTicks ?? 0));
      continue;
    }
    // It ended: the process that waited for it holds its whole life in its children's times.
    const waited = (first.table.get(before.ppid)?.childTicks ?? null) !== null;
    const home = waited ? homeOf(before.ppid) : null;
    count(home, -(before.cpuTicks + (before.childTicks ?? 0)));
    reapedBy.set(pid, home);
  }
  for (const [pid, after] of second.table) {
    if (first.table.get(pid)?.startTicks === after.startTicks) continue;
    count(homeAfter(pid), after.cpuTicks + (after.childTicks ?? 0));
  }

  const costs = new Map<number, ProcessCost>();
  for (const pid of pids) {
    const before = first.table.get(pid);
    const after = second.table.get(pid);
    // A pid another process took during the window: the first one left at it.
    const now = before === undefined || after?.startTicks === before.startTicks ? after : undefined;
    const last = now ?? before;
    if (last === undefined) continue;
    const own = now === undefined ? null : now.cpuTicks - (before?.cpuTicks ?? now.cpuTicks);
    // Children that ended may have been waited for outside the tree; they add none, never less.
    const ticks = own === null || own < 0 ? null : own + Math.max(0, counted.get(pid) ?? 0);
    // A zombie ended: it holds no memory, though its stat stays until it is waited for.
    const ended = now === undefined || now.state === "Z";
    const memory = ended ? null : source.memory(pid);
    costs.set(pid, {
      cpuPct:
        ticks === null || windowMs <= 0 ? null : (ticksToMs(ticks, clockTicks) / windowMs) * 100,
      cpuMs: ticksToMs(last.cpuTicks, clockTicks),
      privateBytes: memory?.bytes ?? null,
      swapBytes: memory?.swapBytes ?? null,
      reapedBy: reapedBy.get(pid) ?? null,
      left: ended,
    });
  }
  return costs;
};

/**
 * D4 "Totals sum the same two values": each value sums the processes that
 * have one, and `skipped` counts those whose unknown value it leaves out
 * (D8). A process that ended in the window adds no memory, and its CPU in
 * it counts in the ancestor that waited for it: neither is left out. A
 * value is `null` only when it leaves some out and has none. A process seen
 * once adds its CPU time but no window CPU.
 */
export function sumCosts(costs: readonly ProcessCost[]): CostSum {
  const sum = (value: (c: ProcessCost) => number | null, held: (c: ProcessCost) => boolean) => {
    const known = costs.flatMap((c) => value(c) ?? []);
    const skipped = costs.filter((c) => value(c) === null && !held(c)).length;
    const total = known.length === 0 && skipped > 0 ? null : known.reduce((a, b) => a + b, 0);
    return { total, skipped };
  };
  const cpu = sum(
    (c) => c.cpuPct,
    (c) => c.reapedBy !== null,
  );
  const memory = sum(
    (c) => c.privateBytes,
    (c) => c.left,
  );
  const swap = sum(
    (c) => c.swapBytes,
    (c) => c.left,
  );
  return {
    cpuPct: cpu.total,
    cpuMs: costs.reduce((a, c) => a + c.cpuMs, 0),
    privateBytes: memory.total,
    swapBytes: swap.total,
    skipped: { cpuPct: cpu.skipped, privateBytes: memory.skipped, swapBytes: swap.skipped },
  };
}
