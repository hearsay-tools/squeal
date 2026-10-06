import { formatRegistration } from "../../../core/delivery/index.js";
import { daemonLiveness } from "../../../core/delivery/liveness.js";
import { usesSqueal } from "../context.js";
import { ensure, settle } from "../ensure.js";
import { additionalContext, type Handler, isRegistered, withContext } from "../hook.js";
import { isInteractive } from "./waiter.js";

/**
 * UserPromptSubmit (task 001-47; lessons, defects 8 and 10). hooks.json arms
 * the idle waiter beside it, because Claude Code runs no Stop after an
 * interrupted turn. This hook keeps the consumer the waiter waits for:
 *
 * - registered: recorded as heard from, and silent;
 * - not registered in an interactive session (the daemon expired it while
 *   the session sat idle with no waiter, after `WAITERLESS_EXPIRY_MS`):
 *   ensure the daemon, which may have idled out since, register, and speak
 *   only when the registration carries known failures, the Stop rule;
 * - `-p` mode registers nothing here: its SessionStart and first
 *   PostToolBatch register and inject the header, and a waiter never runs
 *   there, so nothing expires it early.
 */
export const userPromptSubmit: Handler = (input, location, deps) => {
  if (!usesSqueal(location)) return Promise.resolve(null);
  return withContext(input, location, deps, async (context) => {
    const now = (deps.now ?? Date.now)();
    if (isRegistered(context)) {
      context.store.consumers.touch(context.consumer, now, false);
      return null;
    }
    if (!isInteractive(deps.env)) return null;
    const record = context.store.worktrees.get(context.consumer.worktreeId)?.daemon ?? null;
    if (daemonLiveness(record, now).state !== "alive") {
      if ((await ensure(location, deps, record)) === "spawned") await settle(context, deps);
    }
    const registration = await context.delivery.register(context.consumer);
    return registration.knownFailures.length > 0
      ? additionalContext(input, formatRegistration(registration))
      : null;
  });
};
