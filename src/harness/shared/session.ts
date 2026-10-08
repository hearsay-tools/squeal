import { type ConsumerInput, type HookLocation, usesSqueal } from "./context.js";
import { ensure, settle } from "./ensure.js";
import { type HookDeps, isRegistered, withContext } from "./hook.js";
import { coversNodeTest, primer, withPrimer } from "./primer.js";
import { unregisterSession } from "./sweep.js";

/** Sources after which no earlier run of the session id goes on. */
const SWEEP_SOURCES: ReadonlySet<string> = new Set(["startup", "resume"]);

/**
 * Session and subagent start (D9): ensure the daemon, register the consumer,
 * and return the registration to inject. A repository with neither a store
 * nor a `squeal.config.json` does not use Squeal and gets nothing, not even a
 * daemon. Without a usable store the daemon is still ensured, and the first
 * tool boundary registers. After spawning a daemon, registration waits
 * briefly for its heartbeat, so its header reports a daemon that is about to
 * validate as validating.
 *
 * Lessons, defect 5: a session start (not a subagent's) with source `startup`
 * or `resume` means any earlier run of that session id is gone, so every
 * consumer of the session id still registered (a missed SessionEnd, subagents
 * of the earlier run, other worktrees) is unregistered before the main agent
 * registers. Review wave 4.5, S4: after `compact` the same run goes on, with
 * its subagents possibly running, so it keeps every consumer; a main agent
 * still registered keeps its view too, so nothing it was not told yet is
 * seeded away, and the hook says only the primer. `clear` and a missing source
 * do not sweep either.
 *
 * Task 001-88: wherever Squeal is used, the registration is followed by the
 * primer, and a main agent still registered after `compact` hears the primer
 * alone, since compaction drops it from context. Without a usable store
 * nothing validates yet, so there is no primer either: the first
 * registration, here or on a prompt or a tool boundary, carries it.
 */
export async function startSession(
  input: ConsumerInput & { readonly source?: string },
  location: HookLocation,
  deps: HookDeps,
): Promise<string | null> {
  if (!usesSqueal(location)) return null;
  let ensured = false;
  const text = await withContext(input, location, deps, async (context) => {
    // The store is open already: its daemon record spares the probe a second open (S8).
    ensured = true;
    if ((await ensure(location, deps, context)) === "spawned") await settle(context, deps);
    // Its own consumer is re-registered by `register` in one transaction, so a waiter of the
    // earlier run never sees it missing. Lock files stay: the waiter this SessionStart arms in
    // parallel reuses the main agent's (review wave 3, N3), and subagents have none.
    const main = input.agent_id === undefined;
    if (main && input.source === "compact" && isRegistered(context))
      return primer(deps.command, coversNodeTest(location.root));
    if (main && input.source !== undefined && SWEEP_SOURCES.has(input.source)) {
      await unregisterSession(context, input.session_id, {
        removeLocks: false,
        except: context.consumer,
      });
    }
    // After `compact` the run goes on: its earlier tool calls may be in the registration revision.
    const atStart = input.source !== "compact";
    const registration = await context.delivery.register(context.consumer, { atStart });
    return withPrimer(registration, deps.command, coversNodeTest(location.root));
  });
  if (!ensured) await ensure(location, deps);
  return text;
}

/**
 * Session end (D9): unregister the session's consumers, the main agent and
 * every subagent, in the store of each of `locations`, and remove waiter lock
 * files no waiter holds. A session end carries no agent id, and a subagent
 * ends with its session.
 *
 * Lessons, defect 5: one `/exit` left its consumer registered. So this
 * ignores the end reason (every reason ends the session), never consults or
 * starts the daemon, and looks the session up in every worktree of each
 * store. A session end that still misses is caught by the next session start
 * of the same session id, or by daemon-side expiry (D10).
 */
export async function endSession(
  input: ConsumerInput,
  locations: readonly HookLocation[],
  deps: HookDeps,
): Promise<void> {
  for (const at of locations) {
    await withContext(input, at, deps, async (context) => {
      await unregisterSession(context, input.session_id, { removeLocks: true });
      return null;
    });
  }
}
