import { formatDelta } from "../../core/delivery/format.js";
import { type ConsumerInput, type HookContext, type HookLocation, usesSqueal } from "./context.js";
import { type HookDeps, isRegistered, withContext } from "./hook.js";
import { registerAndHandOver, sayOwed } from "./owed.js";

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
  return withContext(input, location, deps, (context) =>
    turnNews(context, location, deps, options),
  );
}

/**
 * `submitPrompt`'s text for `context`, opened: Pi's run start says it as the run's news too
 * (row 005-117).
 */
export async function turnNews(
  context: HookContext,
  location: HookLocation,
  deps: HookDeps,
  options: { readonly register: boolean },
): Promise<string | null> {
  if (isRegistered(context)) {
    // Row 005-98: a registration whose text was never handed over says it, in the turn.
    const owed = await sayOwed(context, deps, { inTurn: true });
    if (owed !== null) return owed;
    const delta = await context.delivery.startTurn(context.consumer);
    return delta === null ? null : formatDelta(delta, deps.command);
  }
  if (!options.register) return null;
  // In a turn in the registration's transaction: nothing lands untold in between (review wave 10, S1).
  return registerAndHandOver(context, location, deps, {
    whenDown: true,
    register: { inTurn: true },
  });
}
