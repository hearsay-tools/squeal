import { formatRegistration } from "../../../core/delivery/index.js";
import { usesSqueal } from "../context.js";
import { ensure, settle } from "../ensure.js";
import { additionalContext, type Handler, withContext } from "../hook.js";

/**
 * SessionStart and SubagentStart (D9): ensure the daemon, register the
 * consumer, inject the registration. A repository with neither a store nor a
 * `squeal.config.json` does not use Squeal and gets nothing, not even a daemon.
 * After spawning a daemon, registration waits briefly for its heartbeat, so
 * its header reports a daemon that is about to validate as validating.
 */
export const sessionStart: Handler = async (input, location, deps) => {
  if (!usesSqueal(location)) return null;
  const ensured = await ensure(location, deps);
  return withContext(input, location, deps, async (context) => {
    if (ensured === "spawned") await settle(context, deps);
    const registration = await context.delivery.register(context.consumer);
    return additionalContext(input, formatRegistration(registration));
  });
};
