import { setTimeout as sleep } from "node:timers/promises";
import { formatDelta } from "../../core/delivery/index.js";
import { storePaths } from "../../core/store/index.js";
import type { Delta } from "../../core/types/index.js";
import { acquireWaiterLock } from "../../core/waiter-lock/index.js";
import type { ConsumerInput, HookContext, HookLocation } from "./context.js";
import { type HookDeps, isRegistered, withContext } from "./hook.js";

/** The waiter starts beside SessionStart, which registers the consumer; it waits this long for that. */
export const REGISTRATION_GRACE_MS = 10_000;

/** Between waits the waiter checks that its consumer is still registered. */
const WAIT_CHUNK_MS = 1_000;
const REGISTRATION_POLL_MS = 100;

/**
 * The idle waiter, an `asyncRewake` hook armed by SessionStart, Stop and
 * UserPromptSubmit (D9; lessons, defect 10: an interrupted turn runs no
 * Stop): one per consumer, held by a lock; it blocks until the consumer's
 * delta is non-empty, then returns it as text for the harness to wake an
 * idle agent with; `null` otherwise. Task 001-85 (lessons, defect 14): the delta it waits for is
 * the idle one (`HarnessDelivery.waitForDelta`), so it prints only while the
 * consumer is idle and only for the test files pending when the turn ended;
 * a message it wrote mid-turn would land after PostToolBatch's newer one.
 * Timeout after `timeoutMs`, a lost lock race or an unregistered consumer
 * return `null`.
 *
 * The held lock is the session's liveness: the daemon expires a consumer
 * whose lock file no waiter holds after `WAITERLESS_EXPIRY_MS` (task
 * 001-47). A waiter that times out leaves its session alive and its lock
 * file free, so it records the consumer as heard from on the way out, and
 * the 10 minutes start then.
 */
export function waitIdle(
  input: ConsumerInput,
  location: HookLocation,
  deps: HookDeps,
  timeoutMs: number,
): Promise<string | null> {
  return withContext(input, location, deps, async (context) => {
    const lock = acquireWaiterLock(storePaths(location.commonDir).locksDir, context.consumer);
    if (lock === null) return null;
    let gone = false;
    try {
      const outcome = await waitForDelta(context, timeoutMs);
      gone = outcome === "unregistered";
      if (outcome === null) {
        context.store.consumers.touch(context.consumer, (deps.now ?? Date.now)(), false);
      }
      return outcome === "unregistered" || outcome === null ? null : formatDelta(outcome);
    } finally {
      lock.release(gone);
    }
  });
}

async function waitForDelta(
  context: HookContext,
  timeoutMs: number,
): Promise<Delta | "unregistered" | null> {
  const started = performance.now();
  const deadline = started + timeoutMs;
  let seen = false;
  for (;;) {
    const left = deadline - performance.now();
    if (left <= 0) return null;
    if (!isRegistered(context)) {
      if (seen || performance.now() - started >= REGISTRATION_GRACE_MS) return "unregistered";
      await sleep(Math.min(REGISTRATION_POLL_MS, left));
      continue;
    }
    seen = true;
    const delta = await context.delivery.waitForDelta(context.consumer, {
      timeoutMs: Math.min(WAIT_CHUNK_MS, left),
    });
    if (delta !== null) return delta;
  }
}
