import { formatDelta } from "../../core/delivery/index.js";
import { daemonLiveness } from "../../core/delivery/liveness.js";
import { type ConsumerInput, type HookLocation, usesSqueal } from "./context.js";
import { ensure, settle } from "./ensure.js";
import { type HookDeps, isRegistered, withContext } from "./hook.js";
import { withPrimer } from "./primer.js";

/**
 * A user prompt (task 001-47; lessons, defects 8 and 10). A prompt starts a
 * turn (task 001-85; lessons, defect 14): the consumer is in a turn, so the
 * waiter stays silent until a Stop ends it, and an interrupted turn stays in
 * one. Returns the text to put on the prompt, or `null`:
 *
 * - registered: recorded as heard from, in a turn, and the delta not yet
 *   delivered (what the waiter did not wake the agent for while it was idle,
 *   or everything since an interrupt) rides on the prompt as context;
 * - not registered and `options.register` (an interactive session: a store
 *   created after its start, or the daemon expired the consumer while the
 *   session sat idle with no waiter, after `WAITERLESS_EXPIRY_MS`): ensure
 *   the daemon, which may have idled out since, register, and return the
 *   registration. Unlike Stop context, context on a prompt starts no extra
 *   turn, so the header is always worth saying: it is the first one a
 *   session gets when its store came after its start, and after an expiry it
 *   restates the current failures, so a recovery the agent was never told is
 *   not lost (review wave 6, S1);
 * - not registered otherwise: nothing.
 */
export function submitPrompt(
  input: ConsumerInput,
  location: HookLocation,
  deps: HookDeps,
  options: { readonly register: boolean },
): Promise<string | null> {
  if (!usesSqueal(location)) return Promise.resolve(null);
  return withContext(input, location, deps, async (context) => {
    const now = (deps.now ?? Date.now)();
    if (isRegistered(context)) {
      const delta = await context.delivery.startTurn(context.consumer);
      return delta === null ? null : formatDelta(delta);
    }
    if (!options.register) return null;
    const record = context.store.worktrees.get(context.consumer.worktreeId)?.daemon ?? null;
    if (daemonLiveness(record, now).state !== "alive") {
      if ((await ensure(location, deps, record)) === "spawned") await settle(context, deps);
    }
    // In a turn in the registration's transaction: nothing lands untold in between (review wave 10, S1).
    const registration = await context.delivery.register(context.consumer, { inTurn: true });
    return withPrimer(registration);
  });
}
