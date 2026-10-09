import { type InvalidatedPath, isSlowLane, type RunnerAdapter } from "../types/index.js";

/**
 * Spec 004 D2: "a slow file runs in its own runner process, never in the
 * instance that serves fast tiers: for Vitest a second instance created for
 * the slow tier and closed when it drains" (task 004-18).
 *
 * `fast` serves every call but a slow lane's runs; those go to an instance
 * `createSlow` makes on the first of a pass, which `releaseLane` closes once
 * the scheduler drained the pass. The two share nothing, so a slow run never
 * holds the fast instance's calls, and a fast tier runs beside it. Paths
 * invalidated while the slow instance lives reach it before its next run,
 * not at once, which would wait behind the slow run in flight; a config
 * change among them recreates it there as it recreated the fast one. A
 * `touch` (task 001-159) reaches it at once: it waits for nothing, and a
 * slow run in flight must hear it. A fresh instance reads the disk as it
 * is and needs none.
 */
export function withSlowInstance(
  fast: RunnerAdapter,
  createSlow: () => RunnerAdapter,
): RunnerAdapter {
  let slow: RunnerAdapter | null = null;
  let closing: Promise<void> = Promise.resolve();
  let pending: InvalidatedPath[] = [];
  const lane = fast.lane?.bind(fast);

  const drop = (): Promise<void> => {
    const closed = slow;
    slow = null;
    pending = [];
    if (closed === null) return Promise.resolve();
    closing = closing.catch(() => {}).then(() => closed.close());
    return closing;
  };

  return {
    name: fast.name,
    adapterVersion: fast.adapterVersion,
    invalidate(paths) {
      if (slow !== null) {
        // Task 001-159: a touch is heard at once, so a slow run in flight is not stored.
        const touched = paths.filter((p) => p.kind === "touch");
        if (touched.length > 0) void slow.invalidate(touched).catch(() => {});
        pending.push(...paths.filter((p) => p.kind !== "touch"));
      }
      return fast.invalidate(paths);
    },
    affected: (changedPaths) => fast.affected(changedPaths),
    closure: (testFile) => fast.closure(testFile),
    enumerate: (testFile) => fast.enumerate(testFile),
    testFiles: () => fast.testFiles(),
    environment: () => fast.environment(),
    ...(lane === undefined ? {} : { lane }),
    async run(testFiles, options) {
      if (options.lane === undefined || !isSlowLane(options.lane)) {
        return fast.run(testFiles, options);
      }
      await closing.catch(() => {});
      slow ??= createSlow();
      const instance = slow;
      const queued = pending.splice(0);
      if (queued.length > 0) await instance.invalidate(queued);
      return instance.run(testFiles, options);
    },
    async releaseLane(released) {
      if (isSlowLane(released)) await drop();
    },
    async close() {
      const closed = await Promise.allSettled([drop(), fast.close()]);
      const failed = closed.find((result) => result.status === "rejected");
      if (failed !== undefined) throw failed.reason;
    },
  };
}
