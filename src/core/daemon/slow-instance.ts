import type { ResolvedGroup } from "../types/check-groups.js";
import type { TestFileRef } from "../types/keys.js";
import type { Policy } from "../types/policy.js";
import {
  type InvalidatedPath,
  isBesideLane,
  type RunnerAdapter,
  type RunOptions,
  type RunReport,
} from "../types/runner.js";
import { groupLane, isGroupLane } from "../types/scheduler.js";
import { resolveGroups } from "./check-groups.js";

/**
 * Spec 004 D2: "a slow file runs in its own runner process, never in the
 * instance that serves fast tiers: for Vitest a second instance created for
 * the slow tier and closed when it drains" (task 004-18). Spec 019 D3 (row
 * 019-12): so does every check group's lane.
 *
 * `fast` serves every call but the runs of a lane other than its own: a
 * slow lane's, `slow:vitest`, or another group's, `group:<name>:vitest`.
 * Those go to an instance of that lane alone, which `createLane` makes on
 * the lane's first run of a pass and `releaseLane` of the lane closes once
 * the scheduler drained the pass, and also while the lane's files are still
 * queued: when a hold begins, or after 60 s in which no tier of the lane
 * started (row 011-211, `SlowRelease`). Its close runs each project's
 * `globalSetup` teardown, and the lane's next run makes a new instance,
 * which runs the setup again. No two share anything, so a lane's run never
 * holds another lane's calls, and a fast tier runs beside it. Paths
 * invalidated while a lane's instance lives reach it before its next run,
 * not at once, which would wait behind the run in flight; a config change
 * among them recreates it there as it recreated the fast one. A `touch`
 * (task 001-159) reaches it at once: it waits for nothing, and a run in
 * flight must hear it. A fresh instance reads the disk as it is and needs
 * none.
 *
 * `createBeside`, when given, makes one more instance the same way for the
 * runs of a tier beside a named wait's batch (`BESIDE_LANE_PREFIX`, spec 011
 * C4 step 5 as amended 2026-10-29, row 011-269; the coordinator, request
 * 0ca715c0): an edit's tier, or a small later wait's, starts while the
 * batch's tier holds the fast instance. `releaseLane` of a beside lane
 * closes it, once the scheduler has no batch left in that lane. Without it,
 * those runs go to the fast instance.
 */
export function withSlowInstance(
  fast: RunnerAdapter,
  createLane: (lane: string) => RunnerAdapter,
  createBeside?: () => RunnerAdapter,
): RunnerAdapter {
  // By lane: an entry stays once made, so a lane's next run waits for its close.
  const lanes = new Map<string, LaneInstance>();
  const beside = createBeside === undefined ? null : new LaneInstance(createBeside);
  const recheck = fast.recheck?.bind(fast);

  return {
    name: fast.name,
    adapterVersion: fast.adapterVersion,
    // A lane's instance may not exist yet, and the fast one has the same configs (review 001-394
    // B2); a backlog tier and a focused one run on the fast instance (task 001-366, row 011-145).
    traits: fast.traits,
    invalidate(paths) {
      for (const instance of lanes.values()) instance.invalidate(paths);
      beside?.invalidate(paths);
      return fast.invalidate(paths);
    },
    // Task 007-26: the fast instance is rechecked; a lane's lives for one pass of the lane.
    ...(recheck === undefined ? {} : { recheck }),
    affected: (changedPaths) => fast.affected(changedPaths),
    closure: (testFile) => fast.closure(testFile),
    enumerate: (testFile) => fast.enumerate(testFile),
    testFiles: () => fast.testFiles(),
    environment: () => fast.environment(),
    async run(testFiles, options) {
      const at = options.lane;
      // Row 019-12: a group's lane, the default `slow` group's or another's, has an instance of its own.
      if (at !== undefined && isGroupLane(at)) {
        let instance = lanes.get(at);
        if (instance === undefined) {
          instance = new LaneInstance(() => createLane(at));
          lanes.set(at, instance);
        }
        return instance.run(testFiles, options);
      }
      if (at !== undefined && beside !== null && isBesideLane(at)) {
        return beside.run(testFiles, options);
      }
      return fast.run(testFiles, options);
    },
    async releaseLane(released) {
      if (isBesideLane(released)) await beside?.drop();
      else await lanes.get(released)?.drop();
    },
    async close() {
      const closed = await Promise.allSettled([
        ...[...lanes.values()].map((instance) => instance.drop()),
        beside?.drop(),
        fast.close(),
      ]);
      const failed = closed.find((result) => result.status === "rejected");
      if (failed !== undefined) throw failed.reason;
    },
  };
}

/**
 * The group whose Vitest lane is `lane`, of `policy`'s groups (spec 019 D1
 * to D3): the default `slow` group's is `slow:vitest`, another's
 * `group:<name>:vitest`. `null`: none, as for a group a reload removed.
 */
export function vitestLaneGroup(policy: Policy, lane: string): ResolvedGroup | null {
  // The `tests` group's lane is the runner's own, `vitest`: the fast instance's, never one of its own.
  if (!isGroupLane(lane)) return null;
  return resolveGroups(policy).find((group) => groupLane(group.name, "vitest") === lane) ?? null;
}

/**
 * The workers a run without a grant takes in a group's own instance (spec
 * 004 D2, 019 D3): the group's `maxWorkers`, or its `maxParallel` when more,
 * so a tier of that many files runs at once (task 004-34). `undefined`, the
 * configs' own, for a group with neither, as for the fast instance.
 */
export function laneInstanceWorkers(group: ResolvedGroup | null): number | undefined {
  const { maxWorkers, maxParallel } = group?.limits ?? { maxWorkers: null, maxParallel: null };
  const given = [maxWorkers, maxParallel].filter((n) => n !== null);
  return given.length === 0 ? undefined : Math.max(...given);
}

/**
 * One more instance of a lane's runner (spec 004 D2, row 011-269): made by
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
