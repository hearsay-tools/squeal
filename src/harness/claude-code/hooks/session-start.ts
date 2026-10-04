import { ensureDaemon } from "../../../core/daemon/ensure.js";
import { formatRegistration } from "../../../core/delivery/index.js";
import { usesSqueal } from "../context.js";
import { additionalContext, type Handler, withContext } from "../hook.js";

/** Spec 001 D9: "uses the socket only for liveness and nudges with a 100 ms timeout". */
export const SOCKET_TIMEOUT_MS = 100;

/**
 * SessionStart and SubagentStart (D9): ensure the daemon, register the
 * consumer, inject the registration. A repository with neither a store nor a
 * `squeal.config.json` does not use Squeal and gets nothing, not even a daemon.
 */
export const sessionStart: Handler = async (input, location, deps) => {
  if (!usesSqueal(location)) return null;
  await (deps.ensureDaemon ?? ensureDaemon)(location.root, { socketTimeoutMs: SOCKET_TIMEOUT_MS });
  return withContext(input, location, deps, async (context) => {
    const registration = await context.delivery.register(context.consumer);
    return additionalContext(input, formatRegistration(registration));
  });
};
