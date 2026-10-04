import { storePaths } from "../../../core/store/index.js";
import { type Handler, withContext } from "../hook.js";
import { removeWaiterLock } from "../waiter-lock.js";

/**
 * SessionEnd (D9): unregister the session's consumers in this worktree, the
 * main agent and every subagent, and remove waiter lock files no waiter holds.
 * SessionEnd carries no `agent_id`, and a subagent ends with its session.
 */
export const sessionEnd: Handler = (input, location, deps) =>
  withContext(input, location, deps, async (context) => {
    const { locksDir } = storePaths(location.commonDir);
    const consumers = context.store.consumers
      .list(context.consumer.worktreeId)
      .filter((record) => record.consumer.sessionId === input.session_id);
    for (const { consumer } of consumers) {
      await context.delivery.unregister(consumer);
      removeWaiterLock(locksDir, consumer);
    }
    return null;
  });
