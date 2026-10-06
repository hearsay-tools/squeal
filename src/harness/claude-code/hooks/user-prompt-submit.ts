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
 * - not registered in an interactive session (a store created after
 *   SessionStart, or the daemon expired the consumer while the session sat
 *   idle with no waiter, after `WAITERLESS_EXPIRY_MS`): ensure the daemon,
 *   which may have idled out since, register, and inject the registration.
 *   Unlike Stop context, context on a prompt starts no extra turn, so the
 *   header is always worth saying: it is the first one a session gets when
 *   its store came after SessionStart, and after an expiry it restates the
 *   current failures, so a recovery the agent was never told is not lost
 *   (review wave 6, S1);
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
    return additionalContext(input, formatRegistration(registration));
  });
};
