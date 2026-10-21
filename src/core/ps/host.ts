import { readdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfigFile, positiveInteger } from "../daemon/config-file.js";
import { defaultHostSlots } from "../daemon/user-config.js";
import type { AbsolutePath } from "../types/index.js";
import type { HostTotals, PsPlaces, ReadPool, Sample } from "./model.js";
import type { PsHost } from "./shape.js";
import { ticksToMs } from "./source.js";

/*
 * Spec 014 D6 (task 014-07): the host over the window, Squeal's shares of
 * it, and the capacity pool. The host's values are those of the reading at
 * the window's end; its busy CPU is the difference of the two. A permit is
 * held while its holder keeps SQLite's exclusive lock on it, a write lock
 * in `/proc/locks` (`takePermit`, 004 D2); a read lock is a check on its
 * way, and a blocked request waits. Without locks (D10) nobody's permits
 * are known.
 */

export const hostTotals: HostTotals = (first, second) => {
  const a = first.cpuTime;
  const b = second.cpuTime;
  const total = a === null || b === null ? 0 : b.total - a.total;
  return {
    load: second.load,
    cpus: second.cpus,
    cpuPressure: second.cpuPressure,
    memoryPressure: second.memoryPressure,
    memTotal: second.memTotal,
    memAvailable: second.memAvailable,
    swapTotal: second.swapTotal,
    swapUsed: second.swapUsed,
    busyCpuPct: a === null || b === null || total <= 0 ? null : ((b.busy - a.busy) / total) * 100,
  };
};

/**
 * Squeal's CPU over the window, in percent of one CPU, as a percent of the
 * host's busy CPU from the samples' CPU times, which count in `clockTicks`.
 */
export function cpuShare(
  cpuPct: number | null,
  first: Sample,
  second: Sample,
  clockTicks: number,
): number | null {
  const windowMs = second.atMs - first.atMs;
  if (cpuPct === null || first.cpuTime === null || second.cpuTime === null || windowMs <= 0)
    return null;
  const busyPct =
    (ticksToMs(second.cpuTime.busy - first.cpuTime.busy, clockTicks) / windowMs) * 100;
  return busyPct <= 0 ? null : (cpuPct / busyPct) * 100;
}

/** Squeal's private memory as a percent of the host's used memory, `MemTotal - MemAvailable`. */
export function memoryShare(privateBytes: number | null, host: PsHost): number | null {
  if (privateBytes === null || host.memTotal === null || host.memAvailable === null) return null;
  const used = host.memTotal - host.memAvailable;
  return used <= 0 ? null : (privateBytes / used) * 100;
}

const PERMIT = /^(pool\.\d+|slow(\.\d+)?)\.lock$/;

export const readPool: ReadPool = (source, places, daemons) => {
  const slots = hostSlotsOf(places.userConfig, source.host().cpus);
  const locks = source.locks();
  if (locks === null) return { pool: { slots, held: null }, permits: new Map(), foreign: [] };
  const holders = new Map<string, Set<number>>();
  for (const lock of locks) {
    if (lock.blocked || lock.access !== "write" || lock.pid === null) continue;
    const pids = holders.get(lock.file) ?? new Set<number>();
    holders.set(lock.file, pids.add(lock.pid));
  }
  let held = 0;
  const permits = new Map<number, number>();
  const foreign: { pid: number; path: AbsolutePath }[] = [];
  for (const path of permitFiles(places)) {
    const key = source.fileKey(path);
    const pids = key === null ? undefined : holders.get(key);
    if (pids === undefined) continue;
    held++;
    for (const pid of pids) {
      if (daemons.has(pid)) permits.set(pid, (permits.get(pid) ?? 0) + 1);
      else foreign.push({ pid, path });
    }
  }
  return { pool: { slots, held }, permits, foreign };
};

/**
 * `capacity.hostSlots` of the file at `path`, else the CPUs less one, by the
 * loader that never throws (011 C10). `ps` reads no other key, and notes no
 * problem: the daemons note theirs.
 */
function hostSlotsOf(path: AbsolutePath, cpus: number): number {
  const shape = { capacity: { hostSlots: positiveInteger, projects: () => null } };
  const defaults = { capacity: { hostSlots: defaultHostSlots(cpus) } };
  return loadConfigFile(path, shape, defaults).value.capacity.hostSlots;
}

/**
 * The permit files of the pool's directories: `squeal` in the runtime
 * directory and the per-user `squeal-<uid>` in the temp one, as a daemon's
 * `slowSlotDir` picks one by its own environment (004 D2).
 */
function permitFiles(places: PsPlaces): AbsolutePath[] {
  const dirs = new Set<AbsolutePath>([join(places.tempDir, `squeal-${places.uid}`)]);
  if (places.runtimeDir !== null) dirs.add(join(places.runtimeDir, "squeal"));
  const files: AbsolutePath[] = [];
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names.sort()) if (PERMIT.test(name)) files.push(join(dir, name));
  }
  return files;
}
