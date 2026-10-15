import { availableParallelism, loadavg } from "node:os";
import type { Store } from "../types/index.js";

/*
 * Spec 001 D6 as amended (001-368): a `load` retry waits until the one-minute
 * load average is below the host's CPU count, and an inherited failure states
 * the load per CPU when its run ran. The load is the host's at the tier's
 * start, kept per run only for runs that stored a failure.
 */

/** The host's one-minute load average and its CPU count. */
export interface HostLoad {
  /** `null` where the platform has none (Windows). */
  readonly oneMinute: number | null;
  readonly cpus: number;
}

export function hostLoad(): HostLoad {
  return {
    oneMinute: process.platform === "win32" ? null : (loadavg()[0] ?? null),
    cpus: availableParallelism(),
  };
}

/** Whether a `load` retry may run: the load is below the CPU count, or not known. */
export function loadAllows(load: HostLoad): boolean {
  return load.oneMinute === null || load.oneMinute < load.cpus;
}

/** The load per CPU, `null` when not known. */
export function perCpu(load: HostLoad): number | null {
  return load.oneMinute === null ? null : load.oneMinute / Math.max(1, load.cpus);
}

/** `meta` key of the load per CPU of runs that stored a failure, by run id; shared. */
export const RUN_LOADS_META_KEY = "failed-run-loads";

/** The newest runs whose load is kept. */
export const RUN_LOADS_KEPT = 1_024;

/** Every kept run's load per CPU by run id, oldest first; empty when none parses. */
export function readRunLoads(store: Store): Map<string, number> {
  const raw = store.meta.get(RUN_LOADS_META_KEY);
  if (raw === null) return new Map();
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return new Map();
    return new Map(
      Object.entries(value).filter((e): e is [string, number] => typeof e[1] === "number"),
    );
  } catch {
    return new Map();
  }
}

/** Keeps the load per CPU `runId` ran under. */
export function recordRunLoad(store: Store, runId: string, load: number): void {
  store.transaction(() => {
    const loads = readRunLoads(store);
    loads.delete(runId);
    loads.set(runId, load);
    const newest = [...loads].slice(-RUN_LOADS_KEPT);
    store.meta.set(RUN_LOADS_META_KEY, JSON.stringify(Object.fromEntries(newest)));
  });
}
