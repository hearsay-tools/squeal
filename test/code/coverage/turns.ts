/*
 * Row 011-376: the main thread's turns while a test runs, each by its wall
 * time and by the main thread's own CPU time in it. A turn's wall time also
 * holds what the thread did not do: a runner's stalls, waits on the disk. Its
 * CPU time is only the thread's own work, its garbage collection included.
 */

export interface Turns {
  /** Stops the probe: the longest gap between its ticks, by wall and by CPU time, in ms. */
  stop(): { readonly wallMs: number; readonly cpuMs: number };
}

/** The main thread's CPU time so far, in ms. */
export function threadCpuMs(): number {
  const used = process.threadCpuUsage();
  return (used.user + used.system) / 1000;
}

/** Ticks every `everyMs`; a turn longer than that delays the next tick, and its gap holds it. */
export function watchTurns(everyMs = 5): Turns {
  let wall = performance.now();
  let cpu = threadCpuMs();
  let wallMs = 0;
  let cpuMs = 0;
  const tick = setInterval(() => {
    const nowWall = performance.now();
    const nowCpu = threadCpuMs();
    wallMs = Math.max(wallMs, nowWall - wall);
    cpuMs = Math.max(cpuMs, nowCpu - cpu);
    wall = nowWall;
    cpu = nowCpu;
  }, everyMs);
  return {
    stop() {
      clearInterval(tick);
      return { wallMs, cpuMs };
    },
  };
}
