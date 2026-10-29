import {
  type InvalidatedPath,
  isBesideLane,
  isSlowLane,
  type RunnerAdapter,
  type RunOptions,
  type RunReport,
  type TestFileRef,
} from "../types/index.js";
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
 *
 * `createBeside`, when given, makes a third instance the same way for the
 * runs of a tier beside a named wait's batch (`BESIDE_LANE_PREFIX`, spec 011
 * C4 step 5 as amended 2026-10-29, row 011-269; the coordinator, request
 * 0ca715c0): an edit's tier, or a small later wait's, starts while the
 * batch's tier holds the fast instance. `releaseLane` of a beside lane
 * closes it, once the scheduler has no batch left in that lane. Without it,
 * those runs go to the fast instance.
 */
export function withSlowInstance(
  fast: RunnerAdapter,
  createSlow: () => RunnerAdapter,
  createBeside?: () => RunnerAdapter,
): RunnerAdapter {
  const slow = new LaneInstance(createSlow);
  const beside = createBeside === undefined ? null : new LaneInstance(createBeside);
  const lane = fast.lane?.bind(fast);
  const recheck = fast.recheck?.bind(fast);

  return {
    name: fast.name,
    adapterVersion: fast.adapterVersion,
    invalidate(paths) {
      slow.invalidate(paths);
      beside?.invalidate(paths);
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
      const lane = options.lane;
      if (lane !== undefined && isSlowLane(lane)) return slow.run(testFiles, options);
      if (lane !== undefined && beside !== null && isBesideLane(lane)) {
        return beside.run(testFiles, options);
      }
      return fast.run(testFiles, options);
    },
    async releaseLane(released) {
      if (isSlowLane(released)) await slow.drop();
      else if (isBesideLane(released)) await beside?.drop();
    },
    async close() {
      const closed = await Promise.allSettled([slow.drop(), beside?.drop(), fast.close()]);
      const failed = closed.find((result) => result.status === "rejected");
      if (failed !== undefined) throw failed.reason;
    },
  };
}

/**
 * A second instance of a lane's runner (spec 004 D2, row 011-269): made by
 * `create` on its first run, closed by `drop`; the paths invalidated while
 * it lives reach it before its next run, a touch at once.
 */
class LaneInstance {
  #instance: RunnerAdapter | null = null;
  #closing: Promise<void> = Promise.resolve();
  #pending: InvalidatedPath[] = [];

  constructor(private readonly create: () => RunnerAdapter) {}

  invalidate(paths: readonly InvalidatedPath[]): void {
    if (this.#instance === null) return;
    // Task 001-159: a touch is heard at once, so a run in flight is not stored.
    const touched = paths.filter((p) => p.kind === "touch");
    if (touched.length > 0) void this.#instance.invalidate(touched).catch(() => {});
    this.#pending.push(...paths.filter((p) => p.kind !== "touch"));
  }

  async run(testFiles: readonly TestFileRef[], options: RunOptions): Promise<RunReport> {
    await this.#closing.catch(() => {});
    this.#instance ??= this.create();
    const instance = this.#instance;
    const queued = this.#pending.splice(0);
    if (queued.length > 0) await instance.invalidate(queued);
    return instance.run(testFiles, options);
  }

  drop(): Promise<void> {
    const closed = this.#instance;
    this.#instance = null;
    this.#pending = [];
    // A close in progress, a timer's release (row 011-211), still holds a shutdown (review 0.1.322,
    // B4); its error went to the release that started it.
    if (closed === null) return this.#closing.catch(() => {});
    this.#closing = this.#closing.catch(() => {}).then(() => closed.close());
    return this.#closing;
  }
}
