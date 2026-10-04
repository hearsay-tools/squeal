import { formatDelta, formatRegistration } from "../../../core/delivery/index.js";
import { additionalContext, type Handler, isRegistered, withContext } from "../hook.js";

/**
 * PostToolBatch (D9), the primary push channel: the consumer's delta, or
 * nothing. A consumer without a registration (the store did not exist yet at
 * SessionStart, or the registration expired) is registered here instead, so
 * it never waits silently for a SessionStart that will not come again.
 */
export const postToolBatch: Handler = (input, location, deps) =>
  withContext(input, location, deps, async (context) => {
    if (!isRegistered(context)) {
      const registration = await context.delivery.register(context.consumer);
      return additionalContext(input, formatRegistration(registration));
    }
    const delta = await context.delivery.onToolBoundary(context.consumer);
    return delta === null ? null : additionalContext(input, formatDelta(delta));
  });
