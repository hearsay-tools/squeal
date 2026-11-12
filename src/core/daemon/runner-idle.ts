import type { ProjectName } from "../types/common.js";
import type { RunnerEnvironment } from "../types/runner.js";

/**
 * Spec 021 D20.2 (row 021-26): when a recovering runner closes an idle
 * adapter. Each call that reaches the adapter is in flight from `begin` to
 * `end`. Once none is, `close` runs `idleMs()` later unless a call that
 * `counts` starts first. A recheck (task 007-26) does not count: it holds
 * the adapter while it runs, but the quiet passes that make it never keep a
 * host up. `idleMs()` is read each time the clock starts; `0` never closes.
 */
export class IdleClock {
  readonly #idleMs: () => number;
  readonly #close: () => void;
  #busy = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  // The time ran out while an uncounted call was in flight: close once it ends.
  #due = false;

  constructor(idleMs: () => number, close: () => void) {
    this.#idleMs = idleMs;
    this.#close = close;
  }

  begin(counts: boolean): void {
    this.#busy += 1;
    if (!counts) return;
    this.#due = false;
    this.stop();
  }

  end(): void {
    this.#busy -= 1;
    if (this.#busy > 0) return;
    if (this.#due) {
      this.#due = false;
      this.#close();
    } else if (this.#timer === null) {
      this.#arm();
    }
  }

  /** No close until the next call ends. */
  stop(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #arm(): void {
    const ms = this.#idleMs();
    if (!(ms > 0)) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (this.#busy > 0) this.#due = true;
      else this.#close();
    }, ms);
    this.#timer.unref?.();
  }
}

/**
 * Spec 021 D20.3: the projects the adapter after a planned close counts as
 * recreated beyond what its own `invalidate` reported. `before` is the
 * environment the closed adapter last answered (`null`: none was asked, so
 * nothing was keyed from it), `after` the new adapter's (`null`: it failed,
 * so every project is read again and the failure surfaces there). `all`:
 * the batch changed the policy, which an adapter compares with the policy it
 * was created under, and a new one was created under the new one.
 */
export function driftedProjects(
  before: readonly RunnerEnvironment[] | null,
  after: readonly RunnerEnvironment[] | null,
  all: boolean,
): ProjectName[] {
  const was = byProject(before ?? []);
  const now = byProject(after ?? []);
  const names = new Set([...was.keys(), ...now.keys()]);
  if (all || (after === null && before !== null)) return [...names].sort();
  if (before === null) return [];
  return [...names].filter((name) => was.get(name) !== now.get(name)).sort();
}

function byProject(environments: readonly RunnerEnvironment[]): Map<ProjectName, string> {
  return new Map(environments.map((e) => [e.project, JSON.stringify(e)]));
}
