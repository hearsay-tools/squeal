import { availableParallelism, loadavg } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

export interface CapacityWait {
  /** `slow.maxLoadPerCpu`: a 1-minute load per CPU above it defers. */
  readonly maxLoadPerCpu: number;
  /** What is left of the tier's `slow.maxDeferMs`; the caller keeps the per-tier budget. */
  readonly maxDeferMs: number;
  /** Default 15000. */
  readonly recheckMs?: number;
  /** Default `os.loadavg`; only the 1-minute average is read. */
  readonly load?: () => readonly number[];
  /** Default `os.availableParallelism`. */
  readonly cpus?: () => number;
  readonly sleep?: (ms: number) => Promise<unknown>;
  /** Milliseconds on a monotonic clock. Default `performance.now`. */
  readonly now?: () => number;
}

export interface CapacityWaited {
  readonly waitedMs: number;
  /** The load per CPU the file runs under when it ran at the bound, still above the threshold; else `null`. */
  readonly ranUnderLoad: number | null;
}

/**
 * Spec 004 D3: before a slow file, waits while the 1-minute load average per
 * CPU is above `maxLoadPerCpu`, rechecking every `recheckMs`, for at most
 * `maxDeferMs`. Returns at once at or below the threshold. At the bound the
 * file runs anyway, and `ranUnderLoad` carries the load for the run's note:
 * a slow file is delayed, never skipped.
 */
export async function waitForCapacity(wait: CapacityWait): Promise<CapacityWaited> {
  const load = wait.load ?? loadavg;
  const cpus = wait.cpus ?? availableParallelism;
  const sleep = wait.sleep ?? delay;
  const now = wait.now ?? (() => performance.now());
  const recheckMs = wait.recheckMs ?? 15_000;
  const perCpu = (): number => (load()[0] ?? 0) / Math.max(1, cpus());
  const start = now();
  for (;;) {
    const current = perCpu();
    const waitedMs = now() - start;
    if (current <= wait.maxLoadPerCpu) return { waitedMs, ranUnderLoad: null };
    const left = wait.maxDeferMs - waitedMs;
    if (left <= 0) return { waitedMs, ranUnderLoad: current };
    await sleep(Math.min(recheckMs, left));
  }
}
