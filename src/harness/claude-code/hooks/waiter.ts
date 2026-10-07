import { setTimeout as sleep } from "node:timers/promises";
import { formatDelta } from "../../../core/delivery/index.js";
import { storePaths } from "../../../core/store/index.js";
import type { Delta } from "../../../core/types/index.js";
import { acquireWaiterLock } from "../../../core/waiter-lock/index.js";
import type { HookContext } from "../context.js";
import { type Handler, type HookDeps, isRegistered, withContext } from "../hook.js";

/**
 * The waiter's `asyncRewake` hook timeout in hooks.json, seconds. Spec 001
 * D9: "Its `timeout` is explicit and long; expiry is silent and the next Stop
 * re-arms it." UserPromptSubmit re-arms it too (task 001-47).
 */
export const WAITER_HOOK_TIMEOUT_S = 3_600;

/** The waiter gives up a minute before Claude Code would kill it, so expiry is its own. */
export const WAITER_TIMEOUT_MS = (WAITER_HOOK_TIMEOUT_S - 60) * 1_000;

/** The waiter starts beside SessionStart, which registers the consumer; it waits this long for that. */
export const REGISTRATION_GRACE_MS = 10_000;

/** Between waits the waiter checks that its consumer is still registered. */
const WAIT_CHUNK_MS = 1_000;
const REGISTRATION_POLL_MS = 100;

/**
 * Spec 001 D9 and research claude-code-integration §4: in `-p` mode
 * (`CLAUDE_CODE_ENTRYPOINT=sdk-cli`, `CLAUDE_CODE_SESSION_ATTENDED=0`)
 * `asyncRewake` blocks the agent, so the waiter never waits there. Both
 * variables are undocumented; anything but an attended non-SDK session counts
 * as non-interactive.
 */
export function isInteractive(env: HookDeps["env"]): boolean {
  return env.CLAUDE_CODE_SESSION_ATTENDED === "1" && env.CLAUDE_CODE_ENTRYPOINT !== "sdk-cli";
}

/**
 * The idle waiter, an `asyncRewake` hook armed by SessionStart, Stop and
 * UserPromptSubmit (D9; lessons, defect 10: an interrupted turn runs no
 * Stop): one per consumer, held by a lock; it blocks until the consumer's
 * delta is non-empty, then exits 2 with the delta on stderr, which wakes an
 * idle agent. Timeout, a lost lock race, an unregistered consumer or `-p`
 * mode exit 0 silently. Main agents only: a subagent that stopped cannot be
 * woken, and a wake would land in its parent's context.
 *
 * The held lock is the session's liveness: the daemon expires a consumer
 * whose lock file no waiter holds after `WAITERLESS_EXPIRY_MS` (task
 * 001-47). A waiter that times out leaves its session alive and its lock
 * file free, so it records the consumer as heard from on the way out, and
 * the 10 minutes start then.
 */
export const waiter: Handler = async (input, location, deps) => {
  if (input.agent_id !== undefined || !isInteractive(deps.env)) return null;
  return withContext(input, location, deps, async (context) => {
    const lock = acquireWaiterLock(storePaths(location.commonDir).locksDir, context.consumer);
    if (lock === null) return null;
    let gone = false;
    try {
      const outcome = await waitForDelta(context, deps);
      gone = outcome === "unregistered";
      if (outcome === null) {
        context.store.consumers.touch(context.consumer, (deps.now ?? Date.now)(), false);
      }
      return outcome === "unregistered" || outcome === null
        ? null
        : { stderr: formatDelta(outcome), exitCode: 2 };
    } finally {
      lock.release(gone);
    }
  });
};

async function waitForDelta(
  context: HookContext,
  deps: HookDeps,
): Promise<Delta | "unregistered" | null> {
  const started = performance.now();
  const deadline = started + (deps.waiterTimeoutMs ?? WAITER_TIMEOUT_MS);
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
