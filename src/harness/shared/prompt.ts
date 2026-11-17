import { formatDelta } from "../../core/delivery/format.js";
import { daemonLiveness } from "../../core/presence/heartbeat.js";
import { type ConsumerInput, type HookLocation, usesSqueal } from "./context.js";
import { registerFirst } from "./ensure.js";
import { type HookDeps, isRegistered, withContext } from "./hook.js";
import { registerOwing, sayOwed } from "./owed.js";

/**
 * A user prompt (task 001-47; lessons, defects 8 and 10). A prompt starts a
 * turn (task 001-85; lessons, defect 14): the consumer is in a turn, so the
 * waiter stays silent until a Stop ends it, and an interrupted turn stays in
 * one. Returns the text to put on the prompt, or `null`:
 *
 * - registered: recorded as heard from, in a turn, and the delta not yet
 *   delivered (what the waiter did not wake the agent for while it was idle,
 *   or everything since an interrupt) rides on the prompt as context; a
 *   registration whose text was never handed over (row 005-98) is said in
 *   its place;
 * - not registered and `options.register` (an interactive session: a store
 *   created after its start, or the daemon expired the consumer while the
 *   session sat idle with no waiter, after `WAITERLESS_EXPIRY_MS`): register,
 *   then ensure the daemon, which may have idled out since (row 005-98), and
 *   return the registration. Unlike Stop context, context on a prompt starts no extra
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
      // Row 005-98: a registration whose text was never handed over says it, in the turn.
      const owed = await sayOwed(context, deps, { inTurn: true });
      if (owed !== null) {
        await context.delivery.registrationSent(context.consumer);
        return owed;
      }
      const delta = await context.delivery.startTurn(context.consumer);
      return delta === null ? null : formatDelta(delta, deps.command);
    }
    if (!options.register) return null;
    const record = context.store.worktrees.get(context.consumer.worktreeId)?.daemon ?? null;
    const alive = daemonLiveness(record, now).state === "alive";
    // Row 005-98: the registration first, then the daemon's start, inside the hook's timeout.
    const first = alive ? null : await registerFirst(location, deps, context);
    const startingSince = first?.startingSince;
    // In a turn in the registration's transaction: nothing lands untold in between (review wave 10, S1).
    const text = await registerOwing(
      context,
      deps,
      { primer: true },
      {
        inTurn: true,
        ...(startingSince === undefined ? {} : { startingSince }),
      },
    );
    await first?.ensure();
    await context.delivery.registrationSent(context.consumer);
    return text;
  });
}
