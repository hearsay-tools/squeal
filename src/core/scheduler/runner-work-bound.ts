import { CLAIM_GRACE_MS, CLAIM_UNBOUNDED_MS } from "./claims.js";
import type { SchedulerContext } from "./context.js";
import type { Wakes } from "./wakes.js";

/** Past the run a runner-part call may wait for, what the call itself may take: a recreate's start included. */
export const RUNNER_PART_MARGIN_MS = 60_000;

/**
 * The longest one runner-part call is awaited (review wave-13r B2, task
 * 001-228). A recreate waits for the run in flight (task 001-150), which
 * settles within `runner.timeoutMs` and the Vitest adapter's graces, so the
 * bound is that plus `RUNNER_PART_MARGIN_MS`; with no run timeout, as a
 * claim's waiter, `CLAIM_UNBOUNDED_MS`.
 */
export function runnerPartBoundMs(timeoutMs: number | null): number {
  return (timeoutMs ?? CLAIM_UNBOUNDED_MS) + CLAIM_GRACE_MS + RUNNER_PART_MARGIN_MS;
}

/**
 * A fresh bound for one runner part of `context`: a revision's refinement,
 * a `run --all` retry or a baseline (task 001-259), each of which a wait
 * may be queued behind. `SchedulerOptions.runnerPartMs`, or else
 * `runnerPartBoundMs` of the policy's run timeout.
 */
export function runnerPartBound(
  context: Pick<SchedulerContext, "runnerPartMs" | "policy" | "wakes">,
): RunnerPartBound {
  return new RunnerPartBound(
    context.runnerPartMs ?? runnerPartBoundMs(context.policy.runner.timeoutMs),
    context.wakes,
  );
}

/**
 * The bound on the calls of one runner part. A call past `ms` is abandoned:
 * it rejects, so `tryRunner` notes it and the caller takes it as failed, and
 * the revision proceeds. A runner that answers its calls in order answers
 * none after the abandoned one before it, so the later calls of the same
 * runner part are not made and fail at once with the same reason; the next
 * runner part calls the runner again.
 */
export class RunnerPartBound {
  #abandoned: string | null = null;
  readonly #wakes: Wakes;

  /**
   * `wakes` is the scheduler's loop, whose wake ends a call past its bound
   * (row 011-352), `ms` of elapsed time after the call (row 011-369).
   */
  constructor(
    private readonly ms: number,
    wakes: Wakes,
  ) {
    this.#wakes = wakes;
  }

  call<T>(call: () => Promise<T>): Promise<T> {
    if (this.#abandoned !== null) return Promise.reject(new Error(this.#abandoned));
    const answer = call();
    // An answer after the bound is dropped, a rejection included.
    answer.catch(() => {});
    let reject: (error: Error) => void = () => {};
    const abandoned = new Promise<never>((_, rejected) => {
      reject = rejected;
    });
    const wake = this.#wakes.slot("runner-part-bound", () => {
      this.#abandoned ??= `no answer within ${seconds(this.ms)}; the call was abandoned`;
      reject(new Error(this.#abandoned));
    });
    wake.after(this.ms);
    // The runner works on its own meanwhile; the scheduler waits for the answer or this wake (row 011-362).
    const waited = this.#wakes.waitFor(
      { for: "wake", reason: "runner-part-bound" },
      Promise.race([answer, abandoned]),
    );
    return waited.finally(() => wake.drop());
  }
}

function seconds(ms: number): string {
  return ms >= 1_000 ? `${Math.round(ms / 1_000)} s` : `${ms} ms`;
}
