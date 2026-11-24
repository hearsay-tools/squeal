import { CHECK_RUNNERS } from "../daemon/check-groups.js";
import type { CheckRunner } from "../types/check-groups.js";
import type { Policy } from "../types/policy.js";
import type { InvalidatedPath } from "../types/runner.js";
import { runnerKeyingDeferred } from "./deferred-keying.js";

/*
 * Review 0.1.616 B1 (repair 026-r1): spec 026 D1 defers each runner on its
 * own. The daemon's composite runner asks the gate before each keying call
 * to a member (`createCompositeRunner`): a deferred member that no
 * explicit request holds open is shut, gets no call, and owes what it
 * missed. The scheduler holds the runners an explicit request needs open
 * until their owed work is applied (`hold`). An open member that missed a
 * call reports its projects recreated at its next `invalidate` or
 * `recheck`, so the scheduler lists and keys them afresh (D1.4).
 */

/** What a shut runner missed, handed to its first open `invalidate` or `recheck`. */
export interface OwedCalls {
  /** The invalidations it did not get, in arrival order. */
  readonly paths: readonly InvalidatedPath[];
  /** A recheck asked while it was shut. */
  readonly recheck: boolean;
}

/** The member adapter names the daemon gives each runner (`daemon.ts`). */
const ADAPTER_RUNNERS: ReadonlyMap<string, CheckRunner> = new Map([
  ["vitest", "vitest"],
  ["node-test", "nodeTest"],
  ["pytest", "pytest"],
]);

/** One explicit request's hold on the runners it opened (`RunnerGate.hold`). */
export interface RunnerHold {
  /** The deferred runners the hold keeps open; empty: it holds none. */
  readonly runners: readonly CheckRunner[];
  release(): void;
}

export class RunnerGate {
  /** How many explicit requests hold each runner open. */
  readonly #holds = new Map<CheckRunner, number>();
  /** Runners that missed a call: their next open `invalidate` or `recheck` reports a recreate. */
  readonly #stale = new Set<CheckRunner>();
  /** Runners an open `testFiles` has listed in this daemon. */
  readonly #listed = new Set<CheckRunner>();
  readonly #owed = new Map<CheckRunner, { paths: InvalidatedPath[]; recheck: boolean }>();

  constructor(private readonly policy: () => Policy) {}

  /** The runner of a composite member, by its adapter name; `null`: never gated. */
  runnerOf(adapterName: string): CheckRunner | null {
    return ADAPTER_RUNNERS.get(adapterName) ?? null;
  }

  /** D1.1: `runner` waits for an explicit request under the policy as it is now. */
  deferred(runner: CheckRunner): boolean {
    return runnerKeyingDeferred(this.policy(), runner);
  }

  /** D1.2: `runner` gets no keying call now: deferred, and no request holds it open. */
  shut(runner: CheckRunner): boolean {
    return this.deferred(runner) && (this.#holds.get(runner) ?? 0) === 0;
  }

  /** A shut runner missed a call; `paths` and `recheck` it owes its next open one. */
  missed(runner: CheckRunner, paths: readonly InvalidatedPath[] = [], recheck = false): void {
    this.#stale.add(runner);
    if (paths.length === 0 && !recheck) return;
    const owed = this.#owed.get(runner) ?? { paths: [], recheck: false };
    owed.paths.push(...paths);
    owed.recheck ||= recheck;
    this.#owed.set(runner, owed);
  }

  /** An open `testFiles` listed `runner`. */
  listed(runner: CheckRunner): void {
    this.#listed.add(runner);
  }

  /**
   * At an open `invalidate` or `recheck` of `runner`: what it owes, and
   * whether it missed a call, so its projects count as recreated. Taken
   * once; the caller hands it to every member of the runner.
   */
  take(runner: CheckRunner): { readonly owed: OwedCalls; readonly stale: boolean } {
    const owed = this.#owed.get(runner) ?? { paths: [], recheck: false };
    const stale = this.#stale.delete(runner);
    this.#owed.delete(runner);
    return { owed, stale };
  }

  /** A start that keyed `runners` afresh (`baseline`): nothing they missed before is owed. */
  keyed(runners: readonly CheckRunner[]): void {
    for (const runner of runners) {
      if (this.shut(runner)) continue;
      this.#stale.delete(runner);
      this.#owed.delete(runner);
    }
  }

  /**
   * Of `runners`, the deferred ones that owe a wake: each missed a call,
   * and, with `unlistedOnly`, has not been listed in this daemon either.
   */
  owing(runners: readonly CheckRunner[], unlistedOnly = false): CheckRunner[] {
    return runners.filter(
      (runner) =>
        this.deferred(runner) &&
        this.#stale.has(runner) &&
        (!unlistedOnly || !this.#listed.has(runner)),
    );
  }

  /** D1.4: holds the deferred ones of `runners` open until `release`. */
  hold(runners: readonly CheckRunner[]): RunnerHold {
    const held = runners.filter((runner) => this.deferred(runner));
    for (const runner of held) this.#holds.set(runner, (this.#holds.get(runner) ?? 0) + 1);
    let released = false;
    return {
      runners: held,
      release: () => {
        if (released) return;
        released = true;
        for (const runner of held) this.#holds.set(runner, (this.#holds.get(runner) ?? 1) - 1);
      },
    };
  }
}

/** Every runner, for a request that may need any (`run --all`, a retry, a named path). */
export const ALL_RUNNERS: readonly CheckRunner[] = CHECK_RUNNERS;
