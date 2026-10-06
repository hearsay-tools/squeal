import { formatRegistration } from "../../../core/delivery/index.js";
import { usesSqueal } from "../context.js";
import { ensure, settle } from "../ensure.js";
import { additionalContext, type Handler, withContext } from "../hook.js";
import { unregisterSession } from "../sweep.js";

/**
 * SessionStart and SubagentStart (D9): ensure the daemon, register the
 * consumer, inject the registration. A repository with neither a store nor a
 * `squeal.config.json` does not use Squeal and gets nothing, not even a daemon.
 * Without a usable store the daemon is still ensured, and the first
 * PostToolBatch registers. After spawning a daemon, registration waits
 * briefly for its heartbeat, so its header reports a daemon that is about to
 * validate as validating.
 *
 * Lessons, defect 5: a SessionStart (not SubagentStart) for a session id means
 * any earlier run of that session is gone, so every consumer of the session id
 * still registered (a missed SessionEnd, subagents of the earlier run, other
 * worktrees) is unregistered before the main agent registers.
 */
export const sessionStart: Handler = async (input, location, deps) => {
  if (!usesSqueal(location)) return null;
  let ensured = false;
  const outcome = await withContext(input, location, deps, async (context) => {
    // The store is open already: its daemon record spares the probe a second open (S8).
    const record = context.store.worktrees.get(context.consumer.worktreeId)?.daemon ?? null;
    ensured = true;
    if ((await ensure(location, deps, record)) === "spawned") await settle(context, deps);
    // Its own consumer is re-registered by `register` in one transaction, so a waiter of the
    // earlier run never sees it missing. Lock files stay: the waiter this SessionStart arms in
    // parallel reuses the main agent's (review wave 3, N3), and subagents have none.
    if (input.agent_id === undefined) {
      await unregisterSession(context, input.session_id, {
        removeLocks: false,
        except: context.consumer,
      });
    }
    const registration = await context.delivery.register(context.consumer);
    return additionalContext(input, formatRegistration(registration));
  });
  if (!ensured) await ensure(location, deps);
  return outcome;
};
