import { formatDelta, formatRegistration } from "../../../core/delivery/index.js";
import { ensureIfStale } from "../ensure.js";
import { isFork } from "../fork.js";
import { additionalContext, type Handler, isRegistered, withContext } from "../hook.js";

/**
 * PostToolBatch (D9), the primary push channel: the consumer's delta, or
 * nothing. A consumer without a registration (the store did not exist yet at
 * SessionStart, or the registration expired) is registered here instead, so
 * it never waits silently for a SessionStart that will not come again. A
 * heartbeat older than two intervals restarts the daemon (review wave 3,
 * S2); the delta then says no daemon is validating, once. One of Claude
 * Code's internal forks is not a consumer, so it is never registered here
 * (review wave 6, N4).
 */
export const postToolBatch: Handler = async (input, location, deps) => {
  if (isFork(input)) return null;
  return withContext(input, location, deps, async (context) => {
    await ensureIfStale(context, deps);
    if (!isRegistered(context)) {
      const registration = await context.delivery.register(context.consumer, { inTurn: true });
      return additionalContext(input, formatRegistration(registration));
    }
    const delta = await context.delivery.onToolBoundary(context.consumer);
    return delta === null ? null : additionalContext(input, formatDelta(delta));
  });
};
