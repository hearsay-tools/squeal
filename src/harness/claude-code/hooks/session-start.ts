import { usesSqueal } from "../context.js";
import { ensure, settle } from "../ensure.js";
import { isFork } from "../fork.js";
import { additionalContext, type Handler, isRegistered, withContext } from "../hook.js";
import { PRIMER, withPrimer } from "../primer.js";
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
 * Lessons, defect 5: a SessionStart (not SubagentStart) with source `startup`
 * or `resume` means any earlier run of that session id is gone, so every
 * consumer of the session id still registered (a missed SessionEnd, subagents
 * of the earlier run, other worktrees) is unregistered before the main agent
 * registers. Review wave 4.5, S4: after `compact` the same run goes on, with
 * its subagents possibly running, so it keeps every consumer; a main agent
 * still registered keeps its view too, so nothing it was not told yet is
 * seeded away, and the hook says only the primer. `clear` and a missing source
 * do not sweep either.
 *
 * Lessons, defect 9: the SubagentStart of one of Claude Code's internal forks
 * does nothing, since a fork is not a consumer.
 *
 * Task 001-88: wherever Squeal is used, the registration is followed by the
 * primer, and a main agent still registered after `compact` hears the primer
 * alone, since compaction drops it from context. Without a usable store
 * nothing validates yet, so there is no primer either: the first
 * registration, here or in UserPromptSubmit or PostToolBatch, carries it.
 */
/** Sources after which no earlier run of the session id goes on. */
const SWEEP_SOURCES: ReadonlySet<string> = new Set(["startup", "resume"]);

export const sessionStart: Handler = async (input, location, deps) => {
  if (isFork(input) || !usesSqueal(location)) return null;
  let ensured = false;
  const outcome = await withContext(input, location, deps, async (context) => {
    // The store is open already: its daemon record spares the probe a second open (S8).
    const record = context.store.worktrees.get(context.consumer.worktreeId)?.daemon ?? null;
    ensured = true;
    if ((await ensure(location, deps, record)) === "spawned") await settle(context, deps);
    // Its own consumer is re-registered by `register` in one transaction, so a waiter of the
    // earlier run never sees it missing. Lock files stay: the waiter this SessionStart arms in
    // parallel reuses the main agent's (review wave 3, N3), and subagents have none.
    const main = input.agent_id === undefined;
    if (main && input.source === "compact" && isRegistered(context)) {
      return additionalContext(input, PRIMER);
    }
    if (main && input.source !== undefined && SWEEP_SOURCES.has(input.source)) {
      await unregisterSession(context, input.session_id, {
        removeLocks: false,
        except: context.consumer,
      });
    }
    const registration = await context.delivery.register(context.consumer);
    return additionalContext(input, withPrimer(registration));
  });
  if (!ensured) await ensure(location, deps);
  return outcome;
};
