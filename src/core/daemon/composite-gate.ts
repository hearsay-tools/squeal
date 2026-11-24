import { testFileId } from "../keys/reverse-index.js";
import type { RunnerGate } from "../scheduler/runner-gate.js";
import type { CheckRunner } from "../types/check-groups.js";
import type { ProjectName, RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type {
  AffectedTestFiles,
  InvalidatedPath,
  RunnerAdapter,
  RunnerClosure,
  RunnerEnvironment,
} from "../types/runner.js";

/*
 * Review 0.1.616 B1 (repair 026-r1): the composite's keying calls, member by
 * member, through the `RunnerGate`. A shut member (spec 026 D1.2) gets no
 * call: it answers what it last answered while open (its environments,
 * its listing and its closures, so the scheduler keeps its files keyed
 * from the stored closures, D1.3), none before that, and the gate keeps
 * what it missed. An open member that missed a call gets the owed
 * invalidations first and reports its projects recreated, so the
 * scheduler reads its environments and listing again (D1.4).
 */

interface MemberCache {
  environment?: readonly RunnerEnvironment[];
  testFiles?: readonly TestFileRef[];
  readonly closures: Map<string, RunnerClosure>;
}

/** A closure asked of a shut member that never answered it while open. */
export class DeferredClosureError extends Error {}

const NO_FILES: AffectedTestFiles = { direct: [], transitive: [] };

export class CompositeGate {
  readonly #cache = new WeakMap<RunnerAdapter, MemberCache>();

  constructor(private readonly gate: RunnerGate | undefined) {}

  async environment(adapter: RunnerAdapter): Promise<readonly RunnerEnvironment[]> {
    const shut = this.#shut(adapter);
    const cache = this.#of(adapter);
    if (shut !== null) {
      this.gate?.missed(shut);
      return cache.environment ?? [];
    }
    cache.environment = await adapter.environment();
    return cache.environment;
  }

  async testFiles(adapter: RunnerAdapter): Promise<readonly TestFileRef[]> {
    const shut = this.#shut(adapter);
    const cache = this.#of(adapter);
    if (shut !== null) {
      this.gate?.missed(shut);
      return cache.testFiles ?? [];
    }
    cache.testFiles = await adapter.testFiles();
    const runner = this.#runnerOf(adapter);
    if (runner !== null) this.gate?.listed(runner);
    return cache.testFiles;
  }

  async affected(
    adapter: RunnerAdapter,
    changedPaths: readonly RelativePath[],
  ): Promise<AffectedTestFiles> {
    const shut = this.#shut(adapter);
    if (shut === null) return adapter.affected(changedPaths);
    this.gate?.missed(shut);
    return NO_FILES;
  }

  async closure(adapter: RunnerAdapter, testFile: TestFileRef): Promise<RunnerClosure> {
    const shut = this.#shut(adapter);
    const { closures } = this.#of(adapter);
    const id = testFileId(testFile);
    if (shut !== null) {
      this.gate?.missed(shut);
      const cached = closures.get(id);
      if (cached !== undefined) return cached;
      throw new DeferredClosureError(
        `the ${adapter.name} runner is deferred until an explicit request; ${testFile.path} is not walked yet`,
      );
    }
    const closure = await adapter.closure(testFile);
    closures.set(id, closure);
    return closure;
  }

  /** `invalidate` of every member: each runner's owed invalidations first; the projects recreated. */
  async invalidate(
    members: readonly RunnerAdapter[],
    paths: readonly InvalidatedPath[],
  ): Promise<ProjectName[]> {
    const turn = this.#turn();
    const parts = await Promise.all(
      members.map(async (adapter) => {
        const runner = this.#runnerOf(adapter);
        if (runner === null) return (await adapter.invalidate(paths)).recreatedProjects;
        if (turn.shut(runner, paths, false)) return [];
        const { owed, stale } = turn.take(runner);
        const result = await adapter.invalidate([...owed.paths, ...paths]);
        const rechecked = owed.recheck ? await adapter.recheck?.() : undefined;
        return [
          ...result.recreatedProjects,
          ...(rechecked?.recreatedProjects ?? []),
          ...(stale ? await this.#projects(adapter) : []),
        ];
      }),
    );
    return parts.flat();
  }

  /** `recheck` of every member that has one; a stale one is caught up first. */
  async recheck(members: readonly RunnerAdapter[]): Promise<ProjectName[]> {
    const turn = this.#turn();
    const parts = await Promise.all(
      members.map(async (adapter) => {
        const runner = this.#runnerOf(adapter);
        if (runner === null) return (await adapter.recheck?.())?.recreatedProjects ?? [];
        if (turn.shut(runner, [], true)) return [];
        const { owed, stale } = turn.take(runner);
        const invalidated =
          owed.paths.length > 0 ? (await adapter.invalidate(owed.paths)).recreatedProjects : [];
        const rechecked = (await adapter.recheck?.())?.recreatedProjects ?? [];
        return [...invalidated, ...rechecked, ...(stale ? await this.#projects(adapter) : [])];
      }),
    );
    return parts.flat();
  }

  /**
   * One fan-out's view of the gate: a shut runner records its miss once,
   * and an open one takes what it owes once, for all its members.
   */
  #turn() {
    const missed = new Set<CheckRunner>();
    const taken = new Map<CheckRunner, ReturnType<RunnerGate["take"]>>();
    const gate = this.gate;
    return {
      shut: (runner: CheckRunner, paths: readonly InvalidatedPath[], recheck: boolean) => {
        if (gate === undefined || !gate.shut(runner)) return false;
        if (!missed.has(runner)) gate.missed(runner, paths, recheck);
        missed.add(runner);
        return true;
      },
      take: (runner: CheckRunner) => {
        let owed = taken.get(runner);
        if (owed === undefined) {
          owed = gate?.take(runner) ?? { owed: { paths: [], recheck: false }, stale: false };
          taken.set(runner, owed);
        }
        return owed;
      },
    };
  }

  /** An open member's projects, as it lists them now and as it last did. */
  async #projects(adapter: RunnerAdapter): Promise<ProjectName[]> {
    const before = this.#of(adapter).environment ?? [];
    const now = await this.environment(adapter);
    return [...new Set([...before, ...now].map((environment) => environment.project))];
  }

  #runnerOf(adapter: RunnerAdapter): CheckRunner | null {
    return this.gate?.runnerOf(adapter.name) ?? null;
  }

  /** The member's runner when the gate shuts it; `null` when it is open. */
  #shut(adapter: RunnerAdapter): CheckRunner | null {
    const runner = this.#runnerOf(adapter);
    return runner !== null && this.gate?.shut(runner) === true ? runner : null;
  }

  #of(adapter: RunnerAdapter): MemberCache {
    let cache = this.#cache.get(adapter);
    if (cache === undefined) {
      cache = { closures: new Map() };
      this.#cache.set(adapter, cache);
    }
    return cache;
  }
}
