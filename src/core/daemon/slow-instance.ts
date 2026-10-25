import { type InvalidatedPath, isSlowLane, type RunnerAdapter } from "../types/index.js";
import { focusesFile } from "./composite-runner.js";

/**
 * Spec 004 D2: "a slow file runs in its own runner process, never in the
 * instance that serves fast tiers: for Vitest a second instance created for
 * the slow tier and closed when it drains" (task 004-18).
 *
 * `fast` serves every call but a slow lane's runs; those go to an instance
 * `createSlow` makes on the first of a pass, which `releaseLane` closes once
 * the scheduler drained the pass, and also while slow files are still
 * queued: when a hold begins, or after 60 s in which no slow tier started
 * (row 011-211, `SlowRelease`). Its close runs each project's `globalSetup`
 * teardown, and the next slow run makes a new instance, which runs the
 * setup again. The two share nothing, so a slow run never
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
  const recheck = fast.recheck?.bind(fast);

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
    // Task 007-26: the fast instance is rechecked; a slow one lives for one slow pass.
    ...(recheck === undefined ? {} : { recheck }),
    affected: (changedPaths) => fast.affected(changedPaths),
    closure: (testFile) => fast.closure(testFile),
    enumerate: (testFile) => fast.enumerate(testFile),
    testFiles: () => fast.testFiles(),
    omittedTestFiles: () => fast.omittedTestFiles?.() ?? 0,
    // The slow instance may not exist yet; the fast one has the same configs (review 001-394 B2).
    slowWidth: (testFiles) => fast.slowWidth?.(testFiles) ?? testFiles.length,
    // A backlog tier runs on the fast instance (task 001-366).
    tierWidth: (testFile, grant) => fast.tierWidth?.(testFile, grant) ?? grant,
    tierPart: (testFile) => fast.tierPart?.(testFile) ?? "",
    besideBacklog: (testFile) => fast.besideBacklog?.(testFile) ?? false,
    backlogSlot: (testFile) => fast.backlogSlot?.(testFile) ?? null,
    // Row 011-145: a focused tier runs on the fast instance; a slow file gets none.
    focusesFile: (testFile) => focusesFile(fast, testFile),
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
